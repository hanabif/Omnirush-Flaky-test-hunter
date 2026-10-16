import { randomUUID } from 'node:crypto';
import type { InvestigationConfig, RunStatus } from '../domain/schemas.js';
import { ArtifactStore } from '../persistence/artifact-store.js';
import type { InvestigationDatabase } from '../persistence/database.js';
import type { DockerClient } from '../execution/docker-client.js';
import type { TestRunnerAdapter } from '../execution/adapters/types.js';

export interface OneRunRequest { investigationId: string; runId: string; attempt: number; config: InvestigationConfig; adapter: TestRunnerAdapter; artifactStore: ArtifactStore; signal?: AbortSignal; }
export interface RunRecord { id: string; status: RunStatus; exitCode: number | null; durationMs: number; stdoutRef?: string; stderrRef?: string; }

export class OneRunService {
  constructor(private readonly database: InvestigationDatabase, private readonly docker: DockerClient) {}

  async execute(request: OneRunRequest): Promise<RunRecord> {
    const { investigationId, runId, config, adapter } = request;
    if (!this.database.hasRun(runId)) this.database.insertRun({ id: runId, investigationId, attempt: request.attempt, status: 'queued', command: config.command, image: config.image });
    this.database.appendEvent({ id: randomUUID(), investigationId, runId, type: 'run.queued', timestamp: new Date().toISOString(), payload: { attempt: request.attempt } });
    this.database.updateRunStarting(runId, new Date().toISOString());
    this.database.appendEvent({ id: randomUUID(), investigationId, runId, type: 'run.starting', timestamp: new Date().toISOString(), payload: {} });

    const command = adapter.buildCommand(config);
    const execution = await this.docker.run({ image: config.image, command, repositoryPath: config.repositoryPath, artifactDirectory: `${config.repositoryPath}/.flaky-hunter-artifacts/${runId}`, network: config.network, timeoutMs: config.timeoutMs, maxOutputBytes: 1024 * 1024, ...(request.signal ? { signal: request.signal } : {}) });
    if (execution.containerId) this.database.updateRunRunning(runId, execution.containerId);
    const stdoutRef = await request.artifactStore.put(`${investigationId}/runs/${runId}/stdout.log`, execution.stdout);
    const stderrRef = await request.artifactStore.put(`${investigationId}/runs/${runId}/stderr.log`, execution.stderr);
    let status: RunStatus;
    let results: Awaited<ReturnType<typeof adapter.parseResult>>['results'] = [];
    if (execution.cancelled) status = 'cancelled';
    else if (!execution.started) status = 'infra_error';
    else if (execution.timedOut) status = 'timed_out';
    else {
      const parsed = await adapter.parseResult({ runId, stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.exitCode, timedOut: execution.timedOut });
      results = parsed.results;
      status = parsed.parseStatus === 'unparsed' ? 'unparsed' : execution.exitCode === 0 ? 'passed' : 'failed';
    }
    for (const result of results) this.database.insertTestResult(result);
    this.database.completeRun(runId, { status, completedAt: new Date().toISOString(), durationMs: execution.durationMs, exitCode: execution.exitCode, ...(execution.failureKind ? { failureKind: execution.failureKind } : {}), ...(execution.failureMessage ? { failureMessage: execution.failureMessage } : {}), timedOut: execution.timedOut, stdoutRef, stderrRef, metadata: { adapter: adapter.id, testResultCount: results.length } });
    this.database.appendEvent({ id: randomUUID(), investigationId, runId, type: 'run.completed', timestamp: new Date().toISOString(), payload: { status, exitCode: execution.exitCode } });
    return { id: runId, status, exitCode: execution.exitCode, durationMs: execution.durationMs, stdoutRef, stderrRef };
  }
}
