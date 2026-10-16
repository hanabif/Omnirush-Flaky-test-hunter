import type { NormalizedTestResult } from './schemas.js';

export type Classification = 'stable within sample' | 'suspected flaky' | 'consistently failing' | 'inconclusive';
export type Confidence = 'low' | 'medium' | 'high';

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
  confidence: Confidence;
  sampleComplete: boolean;
  firstFailureRunId?: string;
  lastFailureRunId?: string;
}

export function classifyTestResults(testId: string, results: readonly NormalizedTestResult[], runStatuses: readonly string[] = [], expectedAttempts?: number): TestAggregate {
  const relevant = results.filter((result) => result.testId === testId);
  const passed = relevant.filter((result) => result.outcome === 'passed').length;
  const failed = relevant.filter((result) => result.outcome === 'failed').length;
  const timedOut = relevant.filter((result) => result.outcome === 'timed_out').length;
  const crashed = relevant.filter((result) => result.outcome === 'crashed').length;
  const validAttempts = passed + failed + timedOut + crashed;
  const infrastructureErrors = runStatuses.filter((status) => status === 'infra_error').length;
  const failureSignatures: Record<string, number> = {};
  const failures = relevant.filter((result) => result.outcome !== 'passed');
  for (const result of relevant) {
    if (result.failureSignature) failureSignatures[result.failureSignature] = (failureSignatures[result.failureSignature] ?? 0) + 1;
  }

  let classification: Classification = 'inconclusive';
  if (validAttempts > 0 && passed === validAttempts) classification = 'stable within sample';
  else if (validAttempts > 0 && passed === 0 && failed + timedOut + crashed === validAttempts) classification = 'consistently failing';
  else if (passed > 0 && failed + timedOut + crashed > 0) classification = 'suspected flaky';

  const totalAttempts = relevant.length + infrastructureErrors;
  const sampleComplete = expectedAttempts === undefined ? true : totalAttempts >= expectedAttempts;
  const confidence: Confidence = validAttempts === 0 ? 'low' : sampleComplete && validAttempts >= 10 ? 'high' : validAttempts >= 3 ? 'medium' : 'low';
  const firstFailure = failures[0];
  const lastFailure = failures.at(-1);

  return {
    testId, totalAttempts, validAttempts, passed, failed, timedOut, crashed,
    infrastructureErrors, flakeRate: validAttempts ? (failed + timedOut + crashed) / validAttempts : null,
    classification, failureSignatures, confidence, sampleComplete,
    ...(firstFailure ? { firstFailureRunId: firstFailure.runId } : {}),
    ...(lastFailure ? { lastFailureRunId: lastFailure.runId } : {}),
  };
}

export function classifyInvestigation(results: readonly NormalizedTestResult[], runStatuses: readonly string[], expectedAttempts?: number): TestAggregate[] {
  return [...new Set(results.map((result) => result.testId))].sort().map((testId) => classifyTestResults(testId, results, runStatuses, expectedAttempts));
}
