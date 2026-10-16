import { DatabaseSync } from 'node:sqlite';
import type { InvestigationConfig, NormalizedTestResult } from '../domain/schemas.js';

const migrations = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS investigations (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, config_json TEXT NOT NULL,
    tool_version TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, investigation_id TEXT NOT NULL REFERENCES investigations(id), attempt INTEGER NOT NULL,
    status TEXT NOT NULL, command TEXT NOT NULL, image TEXT NOT NULL, queued_at TEXT NOT NULL,
    started_at TEXT, completed_at TEXT, duration_ms INTEGER, exit_code INTEGER, error TEXT,
    UNIQUE(investigation_id, attempt)
  );
  CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), test_id TEXT NOT NULL,
    outcome TEXT NOT NULL, result_json TEXT NOT NULL, UNIQUE(run_id, test_id)
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, investigation_id TEXT NOT NULL REFERENCES investigations(id), run_id TEXT,
    test_id TEXT, type TEXT NOT NULL, timestamp TEXT NOT NULL, payload_json TEXT NOT NULL
  );`,
  `ALTER TABLE runs ADD COLUMN container_id TEXT;
   ALTER TABLE runs ADD COLUMN failure_kind TEXT;
   ALTER TABLE runs ADD COLUMN failure_message TEXT;
   ALTER TABLE runs ADD COLUMN timed_out INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE runs ADD COLUMN stdout_ref TEXT;
   ALTER TABLE runs ADD COLUMN stderr_ref TEXT;
   ALTER TABLE runs ADD COLUMN metadata_json TEXT;`,
];

export class InvestigationDatabase {
  readonly db: DatabaseSync;

  constructor(filename = ':memory:') {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    const initialMigration = migrations[0];
    if (!initialMigration) throw new Error('Initial migration is missing');
    this.db.exec(initialMigration);
    const applied = this.db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
    const versions = new Set(applied.map(({ version }) => version));
    for (let index = 1; index < migrations.length; index += 1) {
      const version = index;
      if (versions.has(version)) continue;
      const migration = migrations[index];
      if (!migration) continue;
      this.db.exec('BEGIN');
      try {
        this.db.exec(migration);
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
  }

  insertInvestigation(id: string, config: InvestigationConfig, toolVersion = '0.1.0'): void {
    this.db.prepare('INSERT INTO investigations(id, status, config_json, tool_version, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'created', JSON.stringify(config), toolVersion, new Date().toISOString());
  }

  insertRun(run: { id: string; investigationId: string; attempt: number; status: string; command: string; image: string }): void {
    this.db.prepare('INSERT INTO runs(id, investigation_id, attempt, status, command, image, queued_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(run.id, run.investigationId, run.attempt, run.status, run.command, run.image, new Date().toISOString());
  }

  insertTestResult(result: NormalizedTestResult): void {
    this.db.prepare('INSERT INTO test_results(run_id, test_id, outcome, result_json) VALUES (?, ?, ?, ?)')
      .run(result.runId, result.testId, result.outcome, JSON.stringify(result));
  }

  updateRunStarting(runId: string, startedAt: string): void {
    this.db.prepare("UPDATE runs SET status = 'starting', started_at = ? WHERE id = ? AND status = 'queued'").run(startedAt, runId);
  }

  updateRunRunning(runId: string, containerId: string): void {
    this.db.prepare("UPDATE runs SET status = 'running', container_id = ? WHERE id = ? AND status IN ('queued', 'starting')").run(containerId, runId);
  }

  completeRun(runId: string, completion: { status: string; completedAt: string; durationMs: number; exitCode: number | null; failureKind?: string; failureMessage?: string; timedOut: boolean; stdoutRef?: string; stderrRef?: string; metadata?: Record<string, unknown> }): void {
    const existing = this.db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as { status?: string } | undefined;
    if (!existing) throw new Error(`Run not found: ${runId}`);
    if (['passed', 'failed', 'timed_out', 'crashed', 'infra_error', 'cancelled', 'unparsed'].includes(existing.status ?? '')) return;
    this.db.prepare('UPDATE runs SET status = ?, completed_at = ?, duration_ms = ?, exit_code = ?, failure_kind = ?, failure_message = ?, timed_out = ?, stdout_ref = ?, stderr_ref = ?, metadata_json = ? WHERE id = ?')
      .run(completion.status, completion.completedAt, completion.durationMs, completion.exitCode, completion.failureKind ?? null, completion.failureMessage ?? null, completion.timedOut ? 1 : 0, completion.stdoutRef ?? null, completion.stderrRef ?? null, completion.metadata ? JSON.stringify(completion.metadata) : null, runId);
  }

  appendEvent(event: { id: string; investigationId: string; runId?: string; testId?: string; type: string; timestamp: string; payload: Record<string, unknown> }): void {
    this.db.prepare('INSERT INTO events(id, investigation_id, run_id, test_id, type, timestamp, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(event.id, event.investigationId, event.runId ?? null, event.testId ?? null, event.type, event.timestamp, JSON.stringify(event.payload));
  }

  hasRun(runId: string): boolean { return Boolean(this.db.prepare('SELECT 1 AS found FROM runs WHERE id = ?').get(runId)); }

  cancelRun(runId: string, message = 'Cancelled by user'): void {
    this.db.prepare("UPDATE runs SET status = 'cancelled', completed_at = ?, failure_kind = 'executor_error', failure_message = ? WHERE id = ? AND status IN ('queued', 'starting', 'running')")
      .run(new Date().toISOString(), message, runId);
  }

  updateInvestigationStatus(id: string, status: string): void {
    this.db.prepare('UPDATE investigations SET status = ?, started_at = CASE WHEN ? = \'running\' AND started_at IS NULL THEN ? ELSE started_at END, completed_at = CASE WHEN ? IN (\'completed\', \'completed_with_errors\', \'cancelled\') THEN ? ELSE completed_at END WHERE id = ?')
      .run(status, status, new Date().toISOString(), status, new Date().toISOString(), id);
  }

  recoverInterruptedRuns(investigationId: string): number {
    const result = this.db.prepare("UPDATE runs SET status = 'infra_error', completed_at = ?, failure_kind = 'executor_error', failure_message = 'Recovered after interrupted worker' WHERE investigation_id = ? AND status IN ('starting', 'running')")
      .run(new Date().toISOString(), investigationId);
    return Number(result.changes);
  }

  runStatuses(investigationId: string): Array<{ attempt: number; status: string }> {
    return this.db.prepare('SELECT attempt, status FROM runs WHERE investigation_id = ? ORDER BY attempt').all(investigationId) as Array<{ attempt: number; status: string }>;
  }

  close(): void { this.db.close(); }
}
