import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectProject, main, progressLine } from '../src/cli/index.js';

describe('phase 5 CLI', () => {
  it('detects npm projects and creates a validated config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flaky-cli-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node test.mjs' } }));
    const detected = await detectProject(root);
    expect(detected.runner).toBe('npm-test');
    const configPath = join(root, 'config.json');
    expect(await main(['init', root, configPath])).toBe(0);
    expect(JSON.parse(await readFile(configPath, 'utf8')).repetitions).toBe(50);
    await rm(root, { recursive: true, force: true });
  });

  it('formats progress for a human-readable CLI view', () => {
    expect(progressLine({ completed: 5, total: 10, active: 2, queued: 3, statuses: { passed: 4, failed: 1 } })).toContain('[50%]');
  });

  it('detects pytest projects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flaky-cli-pytest-'));
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'pytest.ini'), '[pytest]\n');
    expect((await detectProject(root)).runner).toBe('pytest');
    await rm(root, { recursive: true, force: true });
  });
});
