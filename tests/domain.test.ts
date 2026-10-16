import { describe, expect, it } from 'vitest';
import { classifyTestResults } from '../src/domain/classifier.js';
import { InvestigationConfigSchema, TestAnalysisSchema } from '../src/domain/schemas.js';
import { redactSecrets } from '../src/observability/redaction.js';

const config = {
  repositoryPath: '/repo', command: 'npm test', workingDirectory: '/repo', image: 'node:22',
  repetitions: 50, concurrency: 2, timeoutMs: 1000, network: 'none' as const, envAllowlist: [],
};

describe('domain schemas', () => {
  it('accepts a valid investigation config and rejects invalid limits', () => {
    expect(InvestigationConfigSchema.parse(config).repetitions).toBe(50);
    expect(InvestigationConfigSchema.safeParse({ ...config, concurrency: 0 }).success).toBe(false);
  });

  it('requires evidence and limitations in analysis output', () => {
    expect(TestAnalysisSchema.safeParse({ testId: 'x' }).success).toBe(false);
  });
});

describe('classifier', () => {
  const result = (outcome: 'passed' | 'failed', signature?: string) => ({ runId: crypto.randomUUID(), testId: 'test_a', outcome, ...(signature ? { failureSignature: signature } : {}) });
  it('separates infrastructure errors from test outcomes', () => {
    const aggregate = classifyTestResults('test_a', [result('passed'), result('failed', 'assertion')], ['passed', 'failed', 'infra_error']);
    expect(aggregate.classification).toBe('suspected flaky');
    expect(aggregate.validAttempts).toBe(2);
    expect(aggregate.infrastructureErrors).toBe(1);
  });
});

describe('redaction', () => {
  it('redacts nested secret values', () => {
    expect(redactSecrets({ output: 'token=secret-value' }, ['secret-value'])).toEqual({ output: 'token=[REDACTED]' });
  });
});
