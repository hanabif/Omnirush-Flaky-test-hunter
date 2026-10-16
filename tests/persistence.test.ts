import { describe, expect, it } from 'vitest';
import { InvestigationDatabase } from '../src/persistence/database.js';

describe('SQLite foundation', () => {
  it('applies migrations and persists an investigation, run, and result', () => {
    const database = new InvestigationDatabase();
    database.insertInvestigation('inv-1', {
      repositoryPath: '/repo', command: 'npm test', workingDirectory: '/repo', image: 'node:22',
      repetitions: 2, concurrency: 1, timeoutMs: 1000, network: 'none', envAllowlist: [],
    });
    database.insertRun({ id: 'run-1', investigationId: 'inv-1', attempt: 1, status: 'passed', command: 'npm test', image: 'node:22' });
    database.insertTestResult({ runId: 'run-1', testId: 'test_a', outcome: 'passed' });
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM test_results').get()).toEqual({ count: 1 });
    database.close();
  });
});
