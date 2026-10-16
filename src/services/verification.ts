import type { InvestigationConfig } from '../domain/schemas.js';
import { classifyTestResults, type TestAggregate } from '../domain/classifier.js';
import type { ArtifactStore } from '../persistence/artifact-store.js';
import type { InvestigationDatabase } from '../persistence/database.js';
import type { DockerClient } from '../execution/docker-client.js';
import type { TestRunnerAdapter } from '../execution/adapters/types.js';
import { InvestigationScheduler, type ScheduleSummary } from './scheduler.js';

export type VerificationLabel = 'stable within sample' | 'still flaky' | 'inconclusive';
export interface VerificationRequest { investigationId: string; testId: string; config: InvestigationConfig; adapter: TestRunnerAdapter; artifactStore: ArtifactStore; }
export interface VerificationResult { label: VerificationLabel; aggregate: TestAggregate; summary: ScheduleSummary; }

export class VerificationService {
  constructor(private readonly database: InvestigationDatabase, private readonly docker: DockerClient) {}

  async run(request: VerificationRequest): Promise<VerificationResult> {
    if (![50, 100].includes(request.config.repetitions)) throw new Error('Focused verification requires 50 or 100 repetitions');
    const summary = await new InvestigationScheduler(this.database, this.docker).start({ investigationId: request.investigationId, config: request.config, adapter: request.adapter, artifactStore: request.artifactStore });
    const aggregate = classifyTestResults(request.testId, this.database.testResults(request.investigationId), this.database.investigationRunStatuses(request.investigationId), request.config.repetitions);
    const label: VerificationLabel = aggregate.infrastructureErrors > 0 || summary.cancelled > 0 || !aggregate.sampleComplete ? 'inconclusive' : aggregate.classification === 'suspected flaky' ? 'still flaky' : aggregate.classification === 'stable within sample' ? 'stable within sample' : 'inconclusive';
    return { label, aggregate, summary };
  }
}
