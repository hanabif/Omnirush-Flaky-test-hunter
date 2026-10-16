import { randomUUID } from 'node:crypto';
import type { InvestigationConfig } from '../domain/schemas.js';
import type { ArtifactStore } from '../persistence/artifact-store.js';
import type { InvestigationDatabase } from '../persistence/database.js';
import type { DockerClient } from '../execution/docker-client.js';
import type { TestRunnerAdapter } from '../execution/adapters/types.js';
import { OneRunService, type RunRecord } from './one-run-service.js';

export interface SchedulerRequest { investigationId: string; config: InvestigationConfig; adapter: TestRunnerAdapter; artifactStore: ArtifactStore; onProgress?: (progress: SchedulerProgress) => void; }
export interface SchedulerProgress { investigationId: string; total: number; completed: number; active: number; queued: number; statuses: Record<string, number>; }
export interface ScheduleSummary { investigationId: string; total: number; completed: number; cancelled: number; failed: number; records: RunRecord[]; }

export class InvestigationScheduler {
  private readonly controllers = new Map<number, AbortController>();
  private cancelled = false;
  private running?: Promise<ScheduleSummary>;

  constructor(private readonly database: InvestigationDatabase, private readonly docker: DockerClient) {}

  start(request: SchedulerRequest): Promise<ScheduleSummary> {
    if (this.running) throw new Error('Scheduler is already running');
    this.cancelled = false;
    this.running = this.execute(request);
    return this.running;
  }

  cancel(): void { this.cancelled = true; for (const controller of this.controllers.values()) controller.abort(); }

  private async execute(request: SchedulerRequest): Promise<ScheduleSummary> {
    const { investigationId, config } = request;
    this.database.recoverInterruptedRuns(investigationId);
    this.database.updateInvestigationStatus(investigationId, 'running');
    const prior = new Map(this.database.runStatuses(investigationId).map((run) => [run.attempt, run.status]));
    const attempts = Array.from({ length: config.repetitions }, (_, index) => index + 1).filter((attempt) => !['passed', 'failed', 'timed_out', 'crashed', 'infra_error', 'cancelled', 'unparsed'].includes(prior.get(attempt) ?? ''));
    const records: RunRecord[] = [];
    let next = 0;
    const publish = () => {
      const statuses: Record<string, number> = {};
      for (const record of records) statuses[record.status] = (statuses[record.status] ?? 0) + 1;
      request.onProgress?.({ investigationId, total: config.repetitions, completed: records.length, active: this.controllers.size, queued: Math.max(0, attempts.length - next), statuses });
      this.database.appendEvent({ id: randomUUID(), investigationId, type: 'investigation.progress', timestamp: new Date().toISOString(), payload: { completed: records.length, total: config.repetitions, active: this.controllers.size, queued: Math.max(0, attempts.length - next), statuses } });
    };
    publish();
    const worker = async () => {
      while (true) {
        const attempt = attempts[next++];
        if (attempt === undefined) return;
        const runId = `${investigationId}-run-${attempt}`;
        if (this.cancelled) {
          if (!this.database.hasRun(runId)) this.database.insertRun({ id: runId, investigationId, attempt, status: 'queued', command: config.command, image: config.image });
          this.database.cancelRun(runId);
          records.push({ id: runId, status: 'cancelled', exitCode: null, durationMs: 0 });
          publish();
          continue;
        }
        const controller = new AbortController();
        this.controllers.set(attempt, controller);
        try {
          const record = await new OneRunService(this.database, this.docker).execute({ investigationId, runId, attempt, config, adapter: request.adapter, artifactStore: request.artifactStore, signal: controller.signal });
          records.push(record);
        } catch (error) {
          if (!this.database.hasRun(runId)) this.database.insertRun({ id: runId, investigationId, attempt, status: 'queued', command: config.command, image: config.image });
          this.database.completeRun(runId, { status: 'infra_error', completedAt: new Date().toISOString(), durationMs: 0, exitCode: null, failureKind: 'executor_error', failureMessage: error instanceof Error ? error.message : String(error), timedOut: false });
          records.push({ id: runId, status: 'infra_error', exitCode: null, durationMs: 0 });
        } finally { this.controllers.delete(attempt); publish(); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(config.concurrency, attempts.length || 1) }, () => worker()));
    const cancelled = records.filter((record) => record.status === 'cancelled').length;
    const failed = records.filter((record) => !['passed', 'cancelled'].includes(record.status)).length;
    const status = this.cancelled ? 'cancelled' : failed > 0 ? 'completed_with_errors' : 'completed';
    this.database.updateInvestigationStatus(investigationId, status);
    this.database.appendEvent({ id: randomUUID(), investigationId, type: 'investigation.completed', timestamp: new Date().toISOString(), payload: { status, completed: records.length, total: config.repetitions } });
    return { investigationId, total: config.repetitions, completed: records.length, cancelled, failed, records };
  }
}
