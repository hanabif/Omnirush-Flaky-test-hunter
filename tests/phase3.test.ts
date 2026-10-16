import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeFailureSignature } from '../src/domain/failure-signature.js';
import { classifyInvestigation, classifyTestResults } from '../src/domain/classifier.js';
import type { DockerExecutionResult, DockerRunSpec } from '../src/domain/schemas.js';
import type { DockerClient } from '../src/execution/docker-client.js';
import { NpmTestAdapter } from '../src/execution/adapters/npm-test.js';
import { ArtifactStore } from '../src/persistence/artifact-store.js';
import { InvestigationDatabase } from '../src/persistence/database.js';
import { VerificationService } from '../src/services/verification.js';

const baseConfig = { repositoryPath: '/repo', command: 'npm test', workingDirectory: '/repo', image: 'node:22', repetitions: 50, concurrency: 5, timeoutMs: 1000, network: 'none' as const, envAllowlist: [] };

class AlternatingDocker implements DockerClient {
  private count = 0;
  async version() { return { serverVersion: 'fake' }; }
  async inspectImage() {}
  async run(_spec: DockerRunSpec): Promise<DockerExecutionResult> {
    this.count += 1;
    const failed = this.count % 2 === 0;
    return { started: true, containerId: `container-${this.count}`, exitCode: failed ? 1 : 0, timedOut: false, stdout: failed ? 'Error at 2026-01-01T10:00:00Z run-abc' : 'ok', stderr: failed ? 'Error at 2026-01-01T10:00:00Z run-abc' : '', durationMs: 1 };
  }
}

describe('phase 3 normalization and classification', () => {
  it('normalizes unstable failure values into a reusable signature', () => {
    expect(normalizeFailureSignature('Error at 2026-01-01T10:00:00Z run-abc /tmp/session-123')).toBe('error at <timestamp> <run> <path>');
  });

  it('reports all test aggregates with sample completeness and confidence', () => {
    const results = [
      { runId: 'r1', testId: 'stable', outcome: 'passed' as const },
      { runId: 'r2', testId: 'flaky', outcome: 'passed' as const },
      { runId: 'r3', testId: 'flaky', outcome: 'failed' as const, failureSignature: 'assertion' },
    ];
    const aggregates = classifyInvestigation(results, ['passed', 'passed', 'failed'], 2);
    expect(aggregates.map((aggregate) => aggregate.classification)).toEqual(['suspected flaky', 'stable within sample']);
    expect(aggregates[0]?.sampleComplete).toBe(true);
    expect(classifyTestResults('missing', results, ['infra_error'], 2).classification).toBe('inconclusive');
  });

  it('runs a focused 50-attempt verification and labels alternating outcomes flaky', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flaky-verification-'));
    const database = new InvestigationDatabase();
    const investigationId = 'verification-1';
    database.insertInvestigation(investigationId, baseConfig);
    const result = await new VerificationService(database, new AlternatingDocker()).run({ investigationId, testId: 'suite:npm-test', config: baseConfig, adapter: new NpmTestAdapter(), artifactStore: new ArtifactStore(root) });
    expect(result.label).toBe('still flaky');
    expect(result.aggregate.validAttempts).toBe(50);
    expect(result.aggregate.confidence).toBe('high');
    await rm(root, { recursive: true, force: true });
    database.close();
  });
});
