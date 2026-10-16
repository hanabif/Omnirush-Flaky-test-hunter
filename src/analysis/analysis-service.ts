import { randomUUID } from 'node:crypto';
import { classifyTestResults, type TestAggregate } from '../domain/classifier.js';
import { TestAnalysisSchema, type NormalizedTestResult, type TestAnalysis } from '../domain/schemas.js';
import type { ArtifactStore } from '../persistence/artifact-store.js';
import type { InvestigationDatabase } from '../persistence/database.js';

export interface AnalysisInput { investigationId: string; testId: string; aggregate: TestAggregate; results: readonly NormalizedTestResult[]; command: string; evidenceText: string; }
export interface AnalysisProvider { readonly id: string; analyze(input: AnalysisInput): Promise<unknown>; }

export function selectEvidence(results: readonly NormalizedTestResult[], maxResults = 5, maxChars = 12_000): { results: NormalizedTestResult[]; text: string } {
  const failures = results.filter((result) => result.outcome !== 'passed');
  const passes = results.filter((result) => result.outcome === 'passed');
  const selected = [...failures.slice(0, 3), ...passes.slice(0, 2)].slice(0, maxResults);
  let text = selected.map((result) => `[${result.runId}] ${result.outcome}: ${result.failureMessage ?? 'no failure message'}`).join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n[evidence truncated]`;
  return { results: selected, text };
}

export class HeuristicAnalysisProvider implements AnalysisProvider {
  readonly id = 'offline-heuristic';
  async analyze(input: AnalysisInput): Promise<TestAnalysis> {
    const text = input.evidenceText.toLowerCase();
    const likelyCategory = text.includes('timeout') || text.includes('race') || text.includes('eventually') ? 'timing-race' : text.includes('order') || text.includes('shared state') ? 'order-dependence' : text.includes('random') || text.includes('seed') ? 'randomness' : text.includes('environment') || text.includes('platform') ? 'environment' : 'unknown';
    return {
      testId: input.testId,
      observedFacts: [`${input.aggregate.passed} passing and ${input.aggregate.failed + input.aggregate.timedOut + input.aggregate.crashed} non-passing valid outcomes were observed.`, `The normalized failure signatures were: ${Object.keys(input.aggregate.failureSignatures).join(', ') || 'none'}.`],
      likelyCategory,
      hypothesis: likelyCategory === 'unknown' ? 'The available evidence does not identify a specific flakiness mechanism.' : `The failure output is consistent with a possible ${likelyCategory} issue.`,
      evidence: selectEvidence(input.results).results.map((result) => ({ kind: 'result' as const, reference: `result:${result.runId}`, runId: result.runId, testId: result.testId })),
      alternatives: ['The sample may not include enough environmental variation to distinguish competing causes.'],
      recommendation: 'Re-run the focused verification campaign while recording the test order, seed, and environment for each attempt.',
      verificationCommand: input.command,
      confidence: input.aggregate.confidence,
      limitations: ['This offline analysis is a hypothesis, not proof of root cause.', 'Only bounded run output was provided; source inspection was not performed.'],
    };
  }
}

export class AnalysisService {
  constructor(private readonly database: InvestigationDatabase, private readonly provider: AnalysisProvider) {}

  async analyze(investigationId: string, testId: string, artifactStore?: ArtifactStore): Promise<TestAnalysis> {
    const investigation = this.database.getInvestigation(investigationId);
    if (!investigation) throw new Error(`Investigation not found: ${investigationId}`);
    const results = this.database.testResults(investigationId).filter((result) => result.testId === testId);
    const aggregate = classifyTestResults(testId, results, this.database.investigationRunStatuses(investigationId), investigation.config.repetitions);
    const evidence = selectEvidence(results);
    const jobId = randomUUID();
    this.database.createAnalysisJob(jobId, investigationId, testId, this.provider.id);
    this.database.updateAnalysisJob(jobId, 'running');
    try {
      const raw = await this.provider.analyze({ investigationId, testId, aggregate, results: evidence.results, command: investigation.config.command, evidenceText: evidence.text });
      const analysis = TestAnalysisSchema.parse(raw);
      this.database.insertAnalysis(jobId, testId, analysis);
      this.database.updateAnalysisJob(jobId, 'completed');
      return analysis;
    } catch (error) {
      this.database.updateAnalysisJob(jobId, 'failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
