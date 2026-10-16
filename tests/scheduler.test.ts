import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DockerExecutionResult, DockerRunSpec } from '../src/domain/schemas.js';
import type { DockerClient } from '../src/execution/docker-client.js';
import { NpmTestAdapter } from '../src/execution/adapters/npm-test.js';
import { ArtifactStore } from '../src/persistence/artifact-store.js';
import { InvestigationDatabase } from '../src/persistence/database.js';
import { InvestigationScheduler } from '../src/services/scheduler.js';

const config = { repositoryPath: '/repo', command: 'npm test', workingDirectory: '/repo', image: 'node:22', repetitions: 8, concurrency: 3, timeoutMs: 1000, network: 'none' as const, envAllowlist: [] };

class DelayedDocker implements DockerClient {
  active = 0;
  peak = 0;
  constructor(private readonly delayMs = 10) {}
  async version() { return { serverVersion: 'fake' }; }
  async inspectImage() {}
  async run(spec: DockerRunSpec): Promise<DockerExecutionResult> {
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    return new Promise((resolve) => {
      const finish = (cancelled: boolean) => { this.active -= 1; resolve({ started: true, containerId: 'fake', exitCode: cancelled ? null : 0, timedOut: false, cancelled, stdout: 'ok', stderr: '', durationMs: this.delayMs }); };
      const timer = setTimeout(() => finish(false), this.delayMs);
      spec.signal?.addEventListener('abort', () => { clearTimeout(timer); finish(true); }, { once: true });
    });
  }
}

async function setup(repetitions = 8, concurrency = 3) {
  const root = await mkdtemp(join(tmpdir(), 'flaky-scheduler-'));
  const database = new InvestigationDatabase();
  const investigationId = `investigation-${Math.random()}`;
  const investigationConfig = { ...config, repetitions, concurrency };
  database.insertInvestigation(investigationId, investigationConfig);
  return { root, database, investigationId, investigationConfig, artifactStore: new ArtifactStore(root) };
}

describe('bounded investigation scheduler', () => {
  it('respects concurrency and completes every attempt', async () => {
    const state = await setup();
    const docker = new DelayedDocker(15);
    const progress: number[] = [];
    const summary = await new InvestigationScheduler(state.database, docker).start({ investigationId: state.investigationId, config: state.investigationConfig, adapter: new NpmTestAdapter(), artifactStore: state.artifactStore, onProgress: (event) => progress.push(event.completed) });
    expect(summary.completed).toBe(8);
    expect(summary.failed).toBe(0);
    expect(docker.peak).toBeLessThanOrEqual(3);
    expect(progress.at(-1)).toBe(8);
    expect(state.database.db.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 8 });
    await rm(state.root, { recursive: true, force: true });
    state.database.close();
  });

  it('cancels active and queued work while preserving run records', async () => {
    const state = await setup(12, 2);
    const docker = new DelayedDocker(40);
    const scheduler = new InvestigationScheduler(state.database, docker);
    const promise = scheduler.start({ investigationId: state.investigationId, config: state.investigationConfig, adapter: new NpmTestAdapter(), artifactStore: state.artifactStore });
    setTimeout(() => scheduler.cancel(), 8);
    const summary = await promise;
    expect(summary.cancelled).toBeGreaterThan(0);
    expect(state.database.db.prepare("SELECT COUNT(*) AS count FROM runs WHERE status = 'cancelled'").get()).toEqual({ count: summary.cancelled });
    expect((state.database.db.prepare('SELECT status FROM investigations WHERE id = ?').get(state.investigationId) as { status: string }).status).toBe('cancelled');
    await rm(state.root, { recursive: true, force: true });
    state.database.close();
  });

  it('marks interrupted workers as infrastructure errors during recovery', async () => {
    const state = await setup(1, 1);
    state.database.insertRun({ id: 'stale-run', investigationId: state.investigationId, attempt: 1, status: 'running', command: 'npm test', image: 'node:22' });
    expect(state.database.recoverInterruptedRuns(state.investigationId)).toBe(1);
    expect((state.database.db.prepare('SELECT status, failure_kind FROM runs WHERE id = ?').get('stale-run') as { status: string; failure_kind: string }).status).toBe('infra_error');
    await rm(state.root, { recursive: true, force: true });
    state.database.close();
  });
});
