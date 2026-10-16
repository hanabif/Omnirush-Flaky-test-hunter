import { readFile } from 'node:fs/promises';
import type { CommandSpec, InvestigationConfig } from '../../domain/schemas.js';
import type { AdapterParseResult, OutputBundle, TestRunnerAdapter } from './types.js';

export class NpmTestAdapter implements TestRunnerAdapter {
  readonly id = 'npm-test';

  async detect(repositoryPath: string): Promise<boolean> {
    try { const manifest = JSON.parse(await readFile(`${repositoryPath}/package.json`, 'utf8')) as { scripts?: { test?: string } }; return Boolean(manifest.scripts?.test); }
    catch { return false; }
  }

  buildCommand(config: InvestigationConfig): CommandSpec {
    return { executable: 'npm', args: config.testFilter ? ['test', '--', config.testFilter] : ['test'], cwd: '/workspace', env: { CI: 'true' } };
  }

  async parseResult(output: OutputBundle): Promise<AdapterParseResult> {
    const outcome = output.timedOut ? 'timed_out' : output.exitCode === 0 ? 'passed' : 'failed';
    const failureMessage = outcome === 'passed' ? undefined : (output.stderr || output.stdout).trim().slice(0, 4000);
    return { parseStatus: 'parsed', results: [{ runId: output.runId, testId: 'suite:npm-test', outcome, ...(failureMessage ? { failureMessage } : {}) }] };
  }
}
