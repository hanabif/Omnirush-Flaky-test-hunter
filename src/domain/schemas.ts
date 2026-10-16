import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

export const InvestigationConfigSchema = z.object({
  repositoryPath: nonEmpty,
  revision: nonEmpty.optional(),
  command: nonEmpty,
  workingDirectory: nonEmpty,
  image: nonEmpty,
  repetitions: z.number().int().positive(),
  concurrency: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  testFilter: nonEmpty.optional(),
  network: z.enum(['none', 'restricted', 'enabled']),
  envAllowlist: z.array(nonEmpty),
  seed: nonEmpty.optional(),
  orderMode: z.enum(['default', 'random', 'fixed']).optional(),
});

export const InvestigationStatusSchema = z.enum([
  'created', 'validating', 'running', 'analyzing', 'completed', 'cancelled', 'completed_with_errors',
]);

export const RunStatusSchema = z.enum([
  'queued', 'starting', 'running', 'passed', 'failed', 'timed_out', 'crashed', 'infra_error', 'cancelled', 'unparsed',
]);

export const OutcomeSchema = z.enum(['passed', 'failed', 'timed_out', 'crashed', 'unparsed']);

export const NormalizedTestResultSchema = z.object({
  runId: nonEmpty,
  testId: nonEmpty,
  displayName: nonEmpty.optional(),
  outcome: OutcomeSchema,
  durationMs: z.number().int().nonnegative().optional(),
  failureMessage: z.string().optional(),
  failureSignature: nonEmpty.optional(),
  stdoutRef: nonEmpty.optional(),
  stderrRef: nonEmpty.optional(),
});

export const EvidenceReferenceSchema = z.object({
  kind: z.enum(['stdout', 'stderr', 'result', 'source', 'metadata']),
  reference: nonEmpty,
  runId: nonEmpty.optional(),
  testId: nonEmpty.optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

export const TestAnalysisSchema = z.object({
  testId: nonEmpty,
  observedFacts: z.array(nonEmpty).min(1),
  likelyCategory: z.enum(['timing-race', 'shared-state', 'order-dependence', 'randomness', 'resource-contention', 'external-dependency', 'environment', 'unknown']),
  hypothesis: nonEmpty,
  evidence: z.array(EvidenceReferenceSchema).min(1),
  alternatives: z.array(nonEmpty),
  recommendation: nonEmpty,
  verificationCommand: nonEmpty.optional(),
  confidence: z.enum(['low', 'medium', 'high']),
  limitations: z.array(nonEmpty).min(1),
});

export const EventSchema = z.object({
  id: nonEmpty,
  investigationId: nonEmpty,
  runId: nonEmpty.optional(),
  testId: nonEmpty.optional(),
  type: nonEmpty,
  timestamp: z.string().datetime({ offset: true }),
  payload: z.record(z.unknown()),
});

export type InvestigationConfig = z.infer<typeof InvestigationConfigSchema>;
export type InvestigationStatus = z.infer<typeof InvestigationStatusSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type NormalizedTestResult = z.infer<typeof NormalizedTestResultSchema>;
export type TestAnalysis = z.infer<typeof TestAnalysisSchema>;
export type Event = z.infer<typeof EventSchema>;

export const CommandSpecSchema = z.object({
  executable: nonEmpty,
  args: z.array(z.string()),
  cwd: nonEmpty,
  env: z.record(z.string()),
});

export type CommandSpec = z.infer<typeof CommandSpecSchema>;

export type ContainerFailureKind =
  | 'docker_unavailable' | 'image_unavailable' | 'permission_denied' | 'invalid_mount'
  | 'container_start_failed' | 'container_oom' | 'container_killed' | 'executor_timeout' | 'executor_error';

export interface DockerRunSpec {
  image: string;
  command: CommandSpec;
  repositoryPath: string;
  artifactDirectory: string;
  network: InvestigationConfig['network'];
  timeoutMs: number;
  maxOutputBytes: number;
  cpus?: number;
  memoryBytes?: number;
  pidsLimit?: number;
  signal?: AbortSignal;
}

export interface DockerExecutionResult {
  started: boolean;
  containerId?: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled?: boolean;
  failureKind?: ContainerFailureKind;
  failureMessage?: string;
  stdout: string;
  stderr: string;
  durationMs: number;
}
