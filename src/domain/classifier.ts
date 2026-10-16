import type { NormalizedTestResult } from './schemas.js';

export type Classification = 'stable within sample' | 'suspected flaky' | 'consistently failing' | 'inconclusive';

export interface TestAggregate {
  testId: string;
  totalAttempts: number;
  validAttempts: number;
  passed: number;
  failed: number;
  timedOut: number;
  crashed: number;
  infrastructureErrors: number;
  flakeRate: number | null;
  classification: Classification;
  failureSignatures: Record<string, number>;
}

export function classifyTestResults(testId: string, results: readonly NormalizedTestResult[], runStatuses: readonly string[] = []): TestAggregate {
  const relevant = results.filter((result) => result.testId === testId);
  const passed = relevant.filter((result) => result.outcome === 'passed').length;
  const failed = relevant.filter((result) => result.outcome === 'failed').length;
  const timedOut = relevant.filter((result) => result.outcome === 'timed_out').length;
  const crashed = relevant.filter((result) => result.outcome === 'crashed').length;
  const validAttempts = passed + failed + timedOut + crashed;
  const infrastructureErrors = runStatuses.filter((status) => status === 'infra_error').length;
  const failureSignatures: Record<string, number> = {};
  for (const result of relevant) {
    if (result.failureSignature) failureSignatures[result.failureSignature] = (failureSignatures[result.failureSignature] ?? 0) + 1;
  }

  let classification: Classification = 'inconclusive';
  if (validAttempts > 0 && passed === validAttempts) classification = 'stable within sample';
  else if (validAttempts > 0 && passed === 0 && failed + timedOut + crashed === validAttempts) classification = 'consistently failing';
  else if (passed > 0 && failed + timedOut + crashed > 0) classification = 'suspected flaky';

  return {
    testId, totalAttempts: relevant.length + infrastructureErrors, validAttempts, passed, failed, timedOut, crashed,
    infrastructureErrors, flakeRate: validAttempts ? (failed + timedOut + crashed) / validAttempts : null,
    classification, failureSignatures,
  };
}
