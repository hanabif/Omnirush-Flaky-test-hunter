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

  close(): void { this.db.close(); }
}
