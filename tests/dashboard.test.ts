import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvestigationDatabase } from '../src/persistence/database.js';

describe('phase 6 dashboard server', () => {
  it('serves the dashboard shell and health endpoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flaky-dashboard-'));
    process.env.FLAKY_HUNTER_DB = join(root, 'dashboard.db');
    const { createDashboardServer } = await import('../src/server/index.js');
    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Dashboard server did not bind');
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    expect((await health.json()).ok).toBe(true);
    const page = await fetch(base);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Flaky Tests Hunter');
    const created = await fetch(`${base}/api/investigations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repositoryPath: '/workspace/repo', command: 'npm test', workingDirectory: '/workspace',
        image: 'flaky-tests-hunter:test', repetitions: 1, concurrency: 1, timeoutMs: 1000,
        network: 'none', envAllowlist: [], orderMode: 'default',
      }),
    });
    const { id } = await created.json();
    const exported = await fetch(`${base}/api/investigations/${id}/report?format=json`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toBe(`attachment; filename="flaky-hunter-${id}.json"`);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const database = new InvestigationDatabase(process.env.FLAKY_HUNTER_DB);
    database.close();
    await rm(root, { recursive: true, force: true });
    delete process.env.FLAKY_HUNTER_DB;
  });
});
