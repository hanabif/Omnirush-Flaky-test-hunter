import type { CommandSpec, InvestigationConfig, NormalizedTestResult } from '../../domain/schemas.js';

export interface OutputBundle { runId: string; stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; }
export interface AdapterParseResult { results: NormalizedTestResult[]; parseStatus: 'parsed' | 'unparsed'; parserError?: string; }
export interface TestRunnerAdapter {
  readonly id: string;
  detect(repositoryPath: string): Promise<boolean>;
  buildCommand(config: InvestigationConfig): CommandSpec;
  parseResult(output: OutputBundle): Promise<AdapterParseResult>;
}
