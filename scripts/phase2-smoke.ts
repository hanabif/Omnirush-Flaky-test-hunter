import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ArtifactStore } from '../src/persistence/artifact-store.js';
import { InvestigationDatabase } from '../src/persistence/database.js';
import { CliDockerClient } from '../src/execution/docker-client.js';
import { NpmTestAdapter } from '../src/execution/adapters/npm-test.js';
import { InvestigationScheduler } from '../src/services/scheduler.js';
import { preflight } from '../src/execution/preflight.js';
import { InvestigationConfigSchema } from '../src/domain/schemas.js';

const repositoryPath = resolve('fixtures/flaky-demo-repo');
const artifactRoot = resolve('data/phase2-smoke');
const repetitions = Number(process.env.FLAKY_HUNTER_REPETITIONS ?? 5);
const concurrency = Number(process.env.FLAKY_HUNTER_CONCURRENCY ?? 2);
const config = InvestigationConfigSchema.parse({ repositoryPath, command: 'npm test', workingDirectory: repositoryPath, image: 'flaky-tests-hunter:phase-1', repetitions, concurrency, timeoutMs: 30_000, network: 'none', envAllowlist: [] });
const docker = new CliDockerClient();
const report = await preflight(config, docker);
if (!report.passed) { console.error(JSON.stringify(report, null, 2)); process.exit(1); }
await mkdir(artifactRoot, { recursive: true });
const database = new InvestigationDatabase();
const investigationId = randomUUID();
database.insertInvestigation(investigationId, config);
const summary = await new InvestigationScheduler(database, docker).start({ investigationId, config, adapter: new NpmTestAdapter(), artifactStore: new ArtifactStore(artifactRoot), onProgress: (progress) => console.log(JSON.stringify(progress)) });
console.log(JSON.stringify(summary, null, 2));
database.close();
await rm(artifactRoot, { recursive: true, force: true });
