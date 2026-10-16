# Flaky Tests Hunter — Architecture and Implementation Plan

**Status:** Draft v0.1  
**Companion document:** [`flaky-tests-hunter-prd.md`](./flaky-tests-hunter-prd.md)

## 1. Recommended MVP shape

Build a CLI-first application with an optional lightweight local web dashboard. The CLI is the fastest path to a reliable buildathon demo and keeps the execution model transparent. The dashboard can consume the same investigation API and event stream without changing the core engine.

Recommended initial stack:

- **Language:** TypeScript/Node.js for orchestration, CLI, API, and agent integration.
- **Container runtime:** Docker Engine or Docker Desktop through the Docker API/CLI.
- **Persistence:** SQLite for metadata and event state; filesystem object storage for logs and reports.
- **API/UI:** Fastify plus a small React/Vite dashboard, or CLI-only for the first milestone.
- **Validation:** Zod schemas shared between the scheduler, adapters, persistence, and API.
- **Tests:** Vitest for unit/integration tests; Docker-backed end-to-end tests for the execution path.

The design should keep the Docker executor, test adapters, classifier, and analysis interface independent so the stack can be changed later without rewriting the product.

## 2. System context

```text
User
  |
  +--> CLI / Local dashboard
          |
          +--> Investigation API / Application service
                  |
                  +--> Scheduler --> Execution workers --> Docker Engine
                  |                     |
                  |                     +--> Test runner adapter
                  |
                  +--> Result normalizer --> Classifier
                  |
                  +--> Evidence store (SQLite + files)
                  |
                  +--> Analysis queue --> Flaky-test analysis agent
                  |
                  +--> Report generator --> Markdown / JSON
```

## 3. Component responsibilities

### 3.1 CLI and dashboard

Responsibilities:

- Collect and validate investigation configuration.
- Start, monitor, cancel, and resume investigations.
- Display aggregate progress and test stability.
- Show test-specific evidence and analysis.
- Export reports.

The client must not inspect Docker containers directly. It should consume application-level investigation state and events.

### 3.2 Investigation service

Creates an investigation, persists its immutable configuration, performs preflight checks, and coordinates lifecycle transitions:

```text
created -> validating -> running -> analyzing -> completed
                                      |              |
                                      +-> cancelled  +-> completed_with_errors
```

It owns user-facing status but delegates scheduling and execution to specialized components.

### 3.3 Scheduler

The scheduler expands an investigation into run jobs and controls concurrency. It should use a bounded worker pool rather than creating an unbounded promise for every repetition.

Responsibilities:

- Create deterministic run IDs.
- Enforce max concurrency.
- Apply retries only to infrastructure setup failures, never silently retry a test failure.
- Emit run lifecycle events.
- Support cancellation.
- Track leases or heartbeats so interrupted workers can be recovered.

Suggested scheduling policy for the MVP:

1. Queue all attempts for a focused test or suite.
2. Start up to `concurrency` jobs.
3. On completion, persist results before releasing the worker slot.
4. Start analysis jobs after enough evidence exists, without blocking remaining test runs.

### 3.4 Docker executor

The executor turns a run job into one disposable container.

Container defaults:

- Read-only repository mount where possible.
- Separate writable temporary directory for test artifacts.
- No Docker socket mount.
- Non-root user when the image supports it.
- CPU, memory, PID, disk, and wall-clock limits.
- Explicit working directory.
- Explicit environment allowlist.
- Network disabled by default, with an opt-in mode recorded in the run metadata.

The executor captures stdout, stderr, exit code, timeout status, container error, and artifact paths. It must classify startup/runtime failures separately from the test command's own result.

### 3.5 Test-runner adapters

Adapters isolate runner-specific behavior from the core system.

```ts
interface TestRunnerAdapter {
  detect(input: DetectionInput): Promise<DetectionResult>;
  buildCommand(config: TestConfig): Promise<CommandSpec>;
  parseResult(output: OutputBundle): NormalizedTestResult[];
  extractTestIdentifiers(result: NormalizedTestResult): string[];
}
```

Initial adapters:

- `pytest`: parse node IDs and standard failure summaries; capture randomization options where available.
- `npm-test`: initially support a configured reporter/format rather than trying to parse every JavaScript framework.

The adapter should preserve raw output alongside normalized results. Parsing failure must be visible as `unparsed`, not silently treated as a passing run.

### 3.6 Result normalizer

Converts adapter output into a stable schema:

```ts
type Outcome = 'passed' | 'failed' | 'timed_out' | 'crashed' | 'unparsed';

interface NormalizedTestResult {
  testId: string;
  displayName?: string;
  outcome: Outcome;
  durationMs?: number;
  failureMessage?: string;
  failureSignature?: string;
  stdoutRef?: string;
  stderrRef?: string;
}
```

Failure signatures should normalize unstable values such as timestamps, temporary paths, and run IDs where practical. Both the raw failure and normalized signature must be retained.

### 3.7 Flakiness classifier

The classifier operates on normalized results and excludes infrastructure failures from the test outcome denominator.

For each test:

```text
valid_attempts = passed + failed + timed_out + crashed
is_suspected_flaky = passed > 0 AND (failed > 0 OR timed_out > 0 OR crashed > 0)
flake_rate = non_passed_test_outcomes / valid_attempts
```

The report must also expose:

- Total attempts and valid attempts.
- Infrastructure-error count.
- First observed failure and last observed failure.
- Failure signatures and their frequencies.
- Whether the sample reached the requested repetition count.

Do not present statistical confidence as proof of stability. Use labels such as `stable within sample`, `suspected flaky`, `consistently failing`, and `inconclusive`.

### 3.8 Evidence store

Use SQLite for queryable metadata and a filesystem directory for large artifacts.

Suggested tables:

- `investigations`: configuration, repository revision, lifecycle status, timestamps.
- `runs`: one row per container attempt, including status and metadata.
- `test_results`: normalized result for each test in a run.
- `analysis_jobs`: status and model/provider metadata for each suspected test.
- `analyses`: structured agent response and evidence references.
- `events`: append-only lifecycle events for progress and recovery.

Suggested artifact layout:

```text
data/<investigation-id>/
  config.json
  runs/<run-id>/stdout.log
  runs/<run-id>/stderr.log
  runs/<run-id>/result.json
  tests/<encoded-test-id>/summary.json
  report.md
  report.json
```

### 3.9 Analysis agent

The analysis agent is a consumer of evidence, not an executor of arbitrary repository commands.

Input bundle:

- Test source and nearby helper files, bounded by size.
- Test configuration and command.
- Selected passing and failing outputs.
- Normalized failure signatures.
- Run seeds, order, worker count, environment, and timing.
- Relevant repository revision or diff.

Output schema:

```ts
interface TestAnalysis {
  testId: string;
  observedFacts: string[];
  likelyCategory:
    | 'timing-race'
    | 'shared-state'
    | 'order-dependence'
    | 'randomness'
    | 'resource-contention'
    | 'external-dependency'
    | 'environment'
    | 'unknown';
  hypothesis: string;
  evidence: EvidenceReference[];
  alternatives: string[];
  recommendation: string;
  verificationCommand?: string;
  confidence: 'low' | 'medium' | 'high';
  limitations: string[];
}
```

The prompt should require the agent to cite evidence references and explicitly say when evidence is insufficient. Agent output must be schema-validated before it appears in the report.

### 3.10 Report generator

The report generator reads persisted state and produces deterministic Markdown and JSON. It should be rerunnable without rerunning tests. This makes reports suitable for CI artifacts and debugging the reporting layer.

## 4. Data and event model

### Investigation configuration

```ts
interface InvestigationConfig {
  repositoryPath: string;
  revision?: string;
  command: string;
  workingDirectory: string;
  image: string;
  repetitions: 50 | 100 | number;
  concurrency: number;
  timeoutMs: number;
  testFilter?: string;
  network: 'none' | 'restricted' | 'enabled';
  envAllowlist: string[];
  seed?: string;
  orderMode?: 'default' | 'random' | 'fixed';
}
```

### Run status

`queued`, `starting`, `running`, `passed`, `failed`, `timed_out`, `crashed`, `infra_error`, `cancelled`, or `unparsed`.

### Important invariants

1. A run reaches one terminal status exactly once.
2. A test result belongs to exactly one run.
3. Test-level flakiness is calculated only from persisted normalized results.
4. Raw logs are immutable after the run is terminal.
5. An analysis references evidence that remains available in the investigation store.

## 5. API and CLI surface

### CLI commands

```text
flaky-hunter init                         # detect project and create config
flaky-hunter run --config flaky.yml      # start an investigation
flaky-hunter status <investigation-id>   # show progress
flaky-hunter inspect <investigation-id>  # show suspected flakes
flaky-hunter verify <id> --test <test> --runs 100
flaky-hunter report <investigation-id> --format markdown,json
flaky-hunter cancel <investigation-id>
```

### Local API endpoints

```text
POST /investigations
GET  /investigations/:id
GET  /investigations/:id/runs
GET  /investigations/:id/tests
GET  /investigations/:id/tests/:testId
GET  /investigations/:id/events
POST /investigations/:id/cancel
POST /investigations/:id/verify
GET  /investigations/:id/report?format=markdown
```

## 6. Implementation phases

### Phase 0 — Project foundation

Deliverables:

- TypeScript project structure and strict compiler settings.
- Zod schemas for configuration, runs, results, and analysis.
- SQLite migration setup and artifact-store abstraction.
- Structured logging with secret redaction.
- Sample fixture repository containing stable, random, order-dependent, timing-sensitive, and always-failing tests.

Exit criteria: unit tests run locally and the fixture repository can be invoked manually.

### Phase 1 — One-run execution

Deliverables:

- Docker preflight check.
- Secure container executor.
- One-run lifecycle persistence.
- Raw stdout/stderr and result artifact storage.
- First test-runner adapter.

Exit criteria: one fixture test command runs in Docker and produces a complete run record for pass, failure, timeout, and container-start error.

### Phase 2 — Repetition and scheduling

Deliverables:

- Bounded worker pool.
- Configurable repetitions and concurrency.
- Cancellation.
- Event stream/progress reporting.
- Recovery of interrupted runs.

Exit criteria: 50 attempts complete with a concurrency limit, no run is lost, and serial versus parallel behavior is visible in metrics.

### Phase 3 — Normalization and classification

Deliverables:

- Normalized result schema.
- Failure signature normalization.
- Test aggregate queries.
- Suspected-flake classifier.
- Focused verification command.

Exit criteria: the fixture suite produces expected labels for stable, consistently failing, and deliberately flaky tests.

### Phase 4 — Analysis agents and reports

Deliverables:

- Analysis-job queue.
- Evidence selection and context limits.
- Structured analysis prompt and output validation.
- Markdown and JSON report generation.

Exit criteria: every suspected flaky fixture receives a schema-valid analysis with evidence references and limitations.

### Phase 5 — User interface and polish

Deliverables:

- CLI progress output and inspection views.
- Optional local dashboard.
- Configuration wizard and Docker diagnostics.
- Documentation and demo script.

Exit criteria: a new user can run the complete demo from a clean checkout using the documented steps.

## 7. Testing strategy

### Unit tests

- Configuration validation and defaults.
- Failure signature normalization.
- Classification rules and edge cases.
- Scheduler capacity and cancellation.
- Redaction logic.
- Report rendering from a fixed database fixture.
- Agent response schema validation.

### Integration tests

- SQLite persistence and migrations.
- Docker executor lifecycle.
- Adapter parsing against captured runner output.
- Scheduler plus executor with a small repetition count.
- Recovery after a simulated worker interruption.

### End-to-end demo test

Use the fixture repository with known behavior:

1. Stable test passes for all attempts.
2. Always-failing test fails for all valid attempts.
3. Random or timing test produces both outcomes.
4. One test fails only after another test mutates shared state.
5. One command times out.
6. One container setup error is reported as infrastructure failure.

The end-to-end assertion should verify labels, counts, evidence references, and exported report contents—not just process exit codes.

## 8. Security and operational controls

- Validate repository paths and prevent mount traversal outside the requested repository.
- Use an explicit container image allowlist for hosted deployments.
- Keep network disabled by default.
- Do not pass the host environment wholesale into containers.
- Redact secret values before persistence and before constructing agent context.
- Apply maximum log size and artifact retention limits.
- Store model/provider request metadata without storing credentials.
- Use a timeout around both container execution and agent analysis.
- Treat all test output, source comments, and repository files as untrusted prompt content.

## 9. Observability

Every investigation should expose:

- Queue depth and active worker count.
- Run duration distribution.
- Container startup failures.
- Test parser failures.
- Number of valid and invalid attempts.
- Analysis queue latency and failure count.
- Artifact size and retention status.

Use correlation IDs: `investigationId`, `runId`, `testId`, and `analysisJobId` in every structured log event.

## 10. Buildathon demo narrative

1. Introduce a fixture repository where a test passes locally but fails intermittently.
2. Start a 50-run investigation with parallel Docker workers.
3. Show live progress and different outcomes for the same test.
4. Open the test detail to show seeds, order, logs, and failure signatures.
5. Show the analysis agent's evidence-backed hypothesis.
6. Run the focused verification campaign.
7. Export the report as a CI-friendly artifact.

The demo should avoid claiming that the agent has proven the root cause. The strongest claim is that the tool produces reproducible evidence and a ranked, testable explanation faster than manual reruns.

## 11. Recommended repository structure

```text
src/
  cli/
  api/
  domain/
    schemas/
    classifier/
    scheduler/
  execution/
    docker-executor.ts
    adapters/
  persistence/
  analysis/
  reporting/
  observability/
tests/
  unit/
  integration/
  fixtures/flaky-demo-repo/
docs/
  flaky-tests-hunter-prd.md
  flaky-tests-hunter-architecture-plan.md
```

## 12. Decisions to make before implementation

1. Confirm CLI-first versus dashboard-first for the judging flow.
2. Select the first test runner and lock its output format for the demo.
3. Choose the AI provider and define whether analysis is optional when no provider is configured.
4. Decide whether local repositories are the only MVP input.
5. Set default resource limits and network policy.
6. Decide whether Docker images are user-specified, auto-detected, or selected from a small supported catalog.

## 13. Definition of done for the first release

The first release is ready when the fixture demo passes end to end, the core components have automated tests, the tool clearly separates test failures from infrastructure errors, reports can be regenerated from stored evidence, and a new developer can reproduce the demo from the README without hidden credentials or manual container cleanup.
