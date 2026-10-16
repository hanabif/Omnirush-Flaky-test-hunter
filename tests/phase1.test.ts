import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DockerExecutionResult, DockerRunSpec } from '../src/domain/schemas.js';
import { ArtifactStore } from '../src/persistence/artifact-store.js';
import { InvestigationDatabase } from '../src/persistence/database.js';
import { NpmTestAdapter } from '../src/execution/adapters/npm-test.js';
import { preflight } from '../src/execution/preflight.js';
import type { DockerClient } from '../src/execution/docker-client.js';
import { OneRunService } from '../src/services/one-run-service.js';

const config = { repositoryPath: '/repo', command: 'npm test', workingDirectory: '/repo', image: 'node:22', repetitions: 1, concurrency: 1, timeoutMs: 1000, network: 'none' as const, envAllowlist: [] };

class FakeDocker implements DockerClient {
  constructor(private readonly result: DockerExecutionResult) {}
  async version() { return { serverVersion: 'fake' }; }
  async inspectImage() {}
  async run(_spec: DockerRunSpec) { return this.result; }
}

describe('phase 1 execution foundation', () => {
  it('runs a one-run lifecycle and persists raw artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flaky-hunter-'));
    const database = new InvestigationDatabase();
    database.insertInvestigation('inv-1', config);
    const store = new ArtifactStore(root);
    const result = await new OneRunService(database, new FakeDocker({ started: true, containerId: 'container-1', exitCode: 0, timedOut: false, stdout: 'ok', stderr: '', durationMs: 12 })).execute({ investigationId: 'inv-1', runId: 'run-1', attempt: 1, config, adapter: new NpmTestAdapter(), artifactStore: store });
    expect(result.status).toBe('passed');
    expect((database.db.prepare('SELECT status, stdout_ref FROM runs WHERE id = ?').get('run-1') as { status: string; stdout_ref: string }).status).toBe('passed');
    expect((await store.read('inv-1/runs/run-1/stdout.log')).toString()).toBe('ok');
    await rm(root, { recursive: true, force: true });
    database.close();
  });

  it('records infrastructure errors without creating test outcomes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flaky-hunter-'));
    const database = new InvestigationDatabase();
    database.insertInvestigation('inv-2', config);
    const result = await new OneRunService(database, new FakeDocker({ started: false, exitCode: null, timedOut: false, failureKind: 'image_unavailable', failureMessage: 'missing image', stdout: '', stderr: 'missing image', durationMs: 2 })).execute({ investigationId: 'inv-2', runId: 'run-2', attempt: 1, config, adapter: new NpmTestAdapter(), artifactStore: new ArtifactStore(root) });
    expect(result.status).toBe('infra_error');
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM test_results').get()).toEqual({ count: 0 });
    await rm(root, { recursive: true, force: true });
    database.close();
  });

  it('reports preflight failures without throwing', async () => {
    const report = await preflight({ ...config, repositoryPath: 'missing-repository' }, new FakeDocker({ started: false, exitCode: null, timedOut: false, stdout: '', stderr: '', durationMs: 0 }));
    expect(report.passed).toBe(false);
    expect(report.checks.some((check) => check.name === 'repository' && !check.passed)).toBe(true);
  });
});
