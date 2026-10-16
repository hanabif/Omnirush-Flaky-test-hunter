import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { InvestigationConfigSchema, type InvestigationConfig } from '../domain/schemas.js';
import { NpmTestAdapter } from '../execution/adapters/npm-test.js';
import { PytestAdapter } from '../execution/adapters/pytest.js';
import { CliDockerClient } from '../execution/docker-client.js';
import { preflight } from '../execution/preflight.js';
import { ArtifactStore } from '../persistence/artifact-store.js';
import { InvestigationDatabase } from '../persistence/database.js';
import { InvestigationScheduler } from '../services/scheduler.js';
import { buildReport, writeReports } from '../reporting/report.js';

export interface ProjectDetection { testCommand: string; runner: 'npm-test' | 'pytest'; reason: string; }

export async function detectProject(repositoryPath: string): Promise<ProjectDetection> {
  try {
    const manifest = JSON.parse(await readFile(resolve(repositoryPath, 'package.json'), 'utf8')) as { scripts?: { test?: string } };
    if (manifest.scripts?.test) return { testCommand: 'npm test', runner: 'npm-test', reason: 'package.json contains scripts.test' };
  } catch { /* try Python project detection next */ }
  for (const file of ['pytest.ini', 'pyproject.toml', 'setup.cfg']) {
    try { await access(resolve(repositoryPath, file)); return { testCommand: 'python -m pytest', runner: 'pytest', reason: `${file} indicates a pytest project` }; } catch { /* continue */ }
  }
  throw new Error('Could not detect npm test or pytest configuration');
}

export function progressLine(progress: { completed: number; total: number; active: number; queued: number; statuses: Record<string, number> }): string {
  const percentage = progress.total ? Math.round((progress.completed / progress.total) * 100) : 100;
  return `[${percentage}%] completed=${progress.completed}/${progress.total} active=${progress.active} queued=${progress.queued} ${Object.entries(progress.statuses).map(([status, count]) => `${status}=${count}`).join(' ')}`.trim();
}

function databasePath(): string { return resolve(process.env.FLAKY_HUNTER_DB ?? 'data/flaky-hunter.db'); }
async function openDatabase(): Promise<InvestigationDatabase> { const file = databasePath(); await mkdir(dirname(file), { recursive: true }); return new InvestigationDatabase(file); }
function configPath(value?: string): string { return resolve(value ?? 'flaky-hunter.config.json'); }
async function readConfig(file?: string): Promise<InvestigationConfig> { return InvestigationConfigSchema.parse(JSON.parse(await readFile(configPath(file), 'utf8'))); }

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? 'help';
  try {
    if (command === 'help') {
      console.log('flaky-hunter init [repository] | doctor [config] | run --config <file> | status <id> | inspect <id> | report <id> [--format markdown|json]');
      return 0;
    }
    if (command === 'init') {
      const repositoryPath = resolve(argv[1] ?? '.');
      const detected = await detectProject(repositoryPath);
      const config = InvestigationConfigSchema.parse({ repositoryPath, command: detected.testCommand, workingDirectory: repositoryPath, image: process.env.FLAKY_HUNTER_IMAGE ?? 'flaky-tests-hunter:phase-5', repetitions: 50, concurrency: 2, timeoutMs: 30_000, network: 'none', envAllowlist: [] });
      const destination = configPath(argv[2]);
      await writeFile(destination, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      console.log(`Created ${destination} (${detected.runner}: ${detected.reason})`);
      return 0;
    }
    if (command === 'doctor') {
      const config = await readConfig(argv[1]);
      const report = await preflight(config, new CliDockerClient());
      for (const check of report.checks) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.message}`);
      return report.passed ? 0 : 1;
    }
    if (command === 'run') {
      const configIndex = argv.indexOf('--config');
      const config = await readConfig(configIndex >= 0 ? argv[configIndex + 1] : undefined);
      const docker = new CliDockerClient();
      const report = await preflight(config, docker);
      if (!report.passed) { for (const check of report.checks) console.error(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.message}`); return 1; }
      const database = await openDatabase();
      const investigationId = randomUUID();
      database.insertInvestigation(investigationId, config);
      const adapter = config.command.startsWith('npm') ? new NpmTestAdapter() : new PytestAdapter();
      const summary = await new InvestigationScheduler(database, docker).start({ investigationId, config, adapter, artifactStore: new ArtifactStore(resolve('data/artifacts')), onProgress: (progress) => console.log(progressLine(progress)) });
      console.log(JSON.stringify({ investigationId, status: summary.failed ? 'completed_with_errors' : 'completed', completed: summary.completed, total: summary.total }, null, 2));
      database.close();
      return summary.failed ? 2 : 0;
    }
    const id = argv[1];
    if (!id) throw new Error(`A command argument is required: ${command}`);
    const database = await openDatabase();
    if (command === 'status') {
      const report = buildReport(database, id);
      const statuses = database.investigationRunStatuses(id);
      console.log(JSON.stringify({ investigationId: id, status: report.status, totalRuns: statuses.length, counts: Object.fromEntries([...new Set(statuses)].sort().map((status) => [status, statuses.filter((item) => item === status).length])) }, null, 2));
    } else if (command === 'inspect') {
      console.log(JSON.stringify(buildReport(database, id).aggregates, null, 2));
    } else if (command === 'report') {
      const format = argv.includes('--format') ? argv[argv.indexOf('--format') + 1] : 'markdown';
      const output = await writeReports(database, id, resolve('data', id));
      console.log(format === 'json' ? output.jsonPath : output.markdownPath);
    } else throw new Error(`Unknown command: ${command}`);
    database.close();
    return 0;
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const entry = process.argv[1];
if (entry && basename(entry) === 'index.js' && basename(dirname(entry)) === 'cli') void main();
