import { access, readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import type { CommandSpec, InvestigationConfig } from '../../domain/schemas.js';
import type { AdapterParseResult, OutputBundle, TestRunnerAdapter } from './types.js';

export class PytestAdapter implements TestRunnerAdapter {
  readonly id = 'pytest';
  async detect(repositoryPath: string): Promise<boolean> {
    for (const name of ['pytest.ini', 'pyproject.toml', 'setup.cfg']) { try { await access(`${repositoryPath}/${name}`); return true; } catch { /* continue */ } }
    return false;
  }
  buildCommand(_config: InvestigationConfig): CommandSpec { return { executable: 'python', args: ['-m', 'pytest', '--junitxml=/artifacts/pytest-junit.xml'], cwd: '/workspace', env: { CI: 'true' } }; }
  async parseResult(output: OutputBundle): Promise<AdapterParseResult> {
    try {
      const xml = await readFile(`${output.runId}/pytest-junit.xml`, 'utf8');
      const parsed = new XMLParser().parse(xml) as { testsuites?: { testsuite?: { testcase?: Array<Record<string, unknown>> } } };
      const cases = parsed.testsuites?.testsuite?.testcase ?? [];
      return { parseStatus: 'parsed', results: cases.map((testCase) => ({ runId: output.runId, testId: String(testCase.name ?? 'pytest:unknown'), outcome: testCase.failure ? 'failed' as const : 'passed' as const, ...(testCase.failure ? { failureMessage: String(testCase.failure) } : {}) })) };
    } catch (error) { return { parseStatus: 'unparsed', results: [], parserError: error instanceof Error ? error.message : String(error) }; }
  }
}
