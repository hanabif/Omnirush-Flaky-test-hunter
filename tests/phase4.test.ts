import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AnalysisService, HeuristicAnalysisProvider, selectEvidence } from '../src/analysis/analysis-service.js';
import { InvestigationDatabase } from '../src/persistence/database.js';
import { buildReport, renderMarkdown, writeReports } from '../src/reporting/report.js';

const config = { repositoryPath: '/repo', command: 'npm test', workingDirectory: '/repo', image: 'node:22', repetitions: 3, concurrency: 1, timeoutMs: 1000, network: 'none' as const, envAllowlist: [] };

function seedDatabase() {
  const database = new InvestigationDatabase();
  database.insertInvestigation('inv-analysis', config);
  database.insertRun({ id: 'run-1', investigationId: 'inv-analysis', attempt: 1, status: 'passed', command: 'npm test', image: 'node:22' });
  database.insertRun({ id: 'run-2', investigationId: 'inv-analysis', attempt: 2, status: 'failed', command: 'npm test', image: 'node:22' });
  database.insertRun({ id: 'run-3', investigationId: 'inv-analysis', attempt: 3, status: 'failed', command: 'npm test', image: 'node:22' });
  database.insertTestResult({ runId: 'run-1', testId: 'suite:npm-test', outcome: 'passed' });
  database.insertTestResult({ runId: 'run-2', testId: 'suite:npm-test', outcome: 'failed', failureMessage: 'timeout waiting for shared state', failureSignature: 'timeout waiting for shared state' });
  database.insertTestResult({ runId: 'run-3', testId: 'suite:npm-test', outcome: 'failed', failureMessage: 'timeout waiting for shared state', failureSignature: 'timeout waiting for shared state' });
  return database;
}

describe('phase 4 analysis and reporting', () => {
  it('selects bounded evidence with failures before passing examples', () => {
    const evidence = selectEvidence(Array.from({ length: 10 }, (_, index) => ({ runId: `run-${index}`, testId: 'test', outcome: index < 8 ? 'failed' as const : 'passed' as const, failureMessage: 'failure' })));
    expect(evidence.results).toHaveLength(5);
    expect(evidence.results.slice(0, 3).every((result) => result.outcome === 'failed')).toBe(true);
  });

  it('validates and persists a structured analysis', async () => {
    const database = seedDatabase();
    const analysis = await new AnalysisService(database, new HeuristicAnalysisProvider()).analyze('inv-analysis', 'suite:npm-test');
    expect(analysis.likelyCategory).toBe('timing-race');
    expect(database.analyses('inv-analysis')).toHaveLength(1);
    database.close();
  });

  it('renders deterministic JSON and Markdown reports', async () => {
    const database = seedDatabase();
    await new AnalysisService(database, new HeuristicAnalysisProvider()).analyze('inv-analysis', 'suite:npm-test');
    const report = buildReport(database, 'inv-analysis');
    expect(renderMarkdown(report)).toContain('suspected flaky');
    const directory = await mkdtemp(join(tmpdir(), 'flaky-report-'));
    const paths = await writeReports(database, 'inv-analysis', directory);
    expect(JSON.parse(await readFile(paths.jsonPath, 'utf8')).investigationId).toBe('inv-analysis');
    expect(await readFile(paths.markdownPath, 'utf8')).toContain('Likely category');
    await rm(directory, { recursive: true, force: true });
    database.close();
  });
});
