import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ArtifactStore } from '../src/persistence/artifact-store.js';
import { InvestigationDatabase } from '../src/persistence/database.js';
import { CliDockerClient } from '../src/execution/docker-client.js';
import { NpmTestAdapter } from '../src/execution/adapters/npm-test.js';
import { OneRunService } from '../src/services/one-run-service.js';
import { preflight } from '../src/execution/preflight.js';
import { InvestigationConfigSchema } from '../src/domain/schemas.js';

const repositoryPath = resolve('fixtures/flaky-demo-repo');
const artifactRoot = resolve('data/phase1-smoke');
const config = InvestigationConfigSchema.parse({ repositoryPath, command: 'npm test', workingDirectory: repositoryPath, image: 'flaky-tests-hunter:phase-1', repetitions: 1, concurrency: 1, timeoutMs: 30_000, network: 'none', envAllowlist: [] });
const docker = new CliDockerClient();
const report = await preflight(config, docker);
if (!report.passed) { console.error(JSON.stringify(report, null, 2)); process.exit(1); }
await mkdir(artifactRoot, { recursive: true });
const database = new InvestigationDatabase();
const investigationId = randomUUID();
database.insertInvestigation(investigationId, config);
const result = await new OneRunService(database, docker).execute({ investigationId, runId: randomUUID(), attempt: 1, config, adapter: new NpmTestAdapter(), artifactStore: new ArtifactStore(artifactRoot) });
console.log(JSON.stringify({ investigationId, result, stderr: (await new ArtifactStore(artifactRoot).read(result.stderrRef ?? '')).toString() }, null, 2));
database.close();
await rm(artifactRoot, { recursive: true, force: true });
