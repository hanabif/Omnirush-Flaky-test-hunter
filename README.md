# Flaky Tests Hunter

Flaky Tests Hunter is an evidence-first tool for repeating tests in isolated environments, separating test failures from infrastructure failures, and producing actionable investigation reports.

## Phase 5 status

This branch contains the Phase 0 foundation, Phase 1 execution path, Phase 2 scheduler, Phase 3 classification, Phase 4 analysis/reporting, and a usable CLI:

- strict TypeScript project with Node.js 22 pinned in `.nvmrc`;
- Zod schemas for investigation configuration, runs, normalized results, events, and analysis responses;
- pure flakiness classification rules that exclude infrastructure errors;
- SQLite persistence using Node's built-in `node:sqlite` API;
- bounded artifact storage and secret-redacting structured logging primitives;
- deterministic demo fixture modes for stable, failing, flaky, timeout, and order-dependent behavior.
- Docker daemon and local-image preflight checks;
- secure Docker CLI execution with read-only repository mounts, disabled networking by default, resource limits, and bounded output;
- one-run lifecycle persistence with queued, starting, running, and terminal states;
- immutable stdout/stderr artifacts and lifecycle events;
- suite-level npm test adapter and a conservative pytest JUnit adapter.
- bounded worker-pool scheduling with configurable repetitions and concurrency;
- progress callbacks and append-only progress events;
- cancellation of queued and active runs through abort signals;
- recovery of interrupted `starting`/`running` records as explicit infrastructure errors.
- normalized failure signatures that remove timestamps, UUIDs, temporary paths, and run identifiers while retaining raw failure messages;
- per-test aggregate queries with pass/fail/timeout/crash counts, infrastructure-error counts, flake rates, first/last failures, and signature frequencies;
- honest confidence and sample-completeness labels;
- focused verification support for exactly 50 or 100 repetitions.
- bounded evidence selection for analysis context;
- schema-validated analysis provider contract and offline heuristic provider;
- persisted analysis jobs and structured analyses;
- deterministic Markdown and JSON report generation.
- CLI project intake, status, inspection, report, run, and Docker diagnostics commands;
- automatic npm/pytest project detection and validated config generation;
- human-readable progress output for repeated investigations.

The dashboard and hosted AI-provider integration are intentionally deferred. The provider interface is ready for an explicitly configured model without requiring credentials for local development.

## Requirements

- Node.js 22.14.0 (use `nvm use` with `.nvmrc` where available)
- npm 10+
- Docker Engine or Docker Desktop for the container build

## Setup

```sh
npm ci
cp .env.example .env
```

No credentials are required for Phase 5.

## Run checks

The canonical offline test command is:

```sh
make test
```

Equivalent commands:

```sh
npm run typecheck
npm test -- --run
npm run build
```

## Fixture smoke checks

The fixture is kept inside the repository and does not require network access:

```sh
cd fixtures/flaky-demo-repo
npm test
FIXTURE_MODE=failing npm test
FIXTURE_MODE=flaky FIXTURE_OUTCOME=1 npm test
```

## Phase 1 Docker execution

Build and run the reproducible Phase 1 checks:

```sh
docker build -t flaky-tests-hunter:phase-1 .
docker run --rm flaky-tests-hunter:phase-1
```

The Docker image installs dependencies from the committed lockfile and runs the same test command as `make test`.

The execution primitives are available to the TypeScript application through `src/execution/` and `src/services/one-run-service.ts`. Before a real investigation, call `preflight()` with an `InvestigationConfig`; it verifies the repository, Docker daemon, and image without starting the test command. `OneRunService` then records a run, invokes one disposable container, stores stdout/stderr artifacts, parses the adapter result, and finalizes the run record.

With Docker Desktop/Engine running and the pinned image available locally, the end-to-end Phase 1 smoke check is:

```sh
npm run phase1:smoke
```

The Docker executor defaults to:

- `--network none` unless configuration explicitly enables networking;
- read-only repository mount at `/workspace`;
- no Docker socket mount and no inherited host environment;
- read-only container root filesystem, dropped capabilities, and no-new-privileges;
- CPU, memory, PID, timeout, and output limits;
- `--pull=never`, so missing images are reported as infrastructure errors instead of being pulled implicitly.

## Phase 2 repeated investigations

Run a real Docker-backed repeated campaign using the scheduler:

```sh
npm run phase2:smoke
FLAKY_HUNTER_REPETITIONS=50 FLAKY_HUNTER_CONCURRENCY=4 npm run phase2:smoke
```

The scheduler emits JSON progress lines, keeps active workers at or below `concurrency`, preserves each attempt as a run record, and reports `completed`, `completed_with_errors`, or `cancelled` at investigation level. The scheduler API is in `src/services/scheduler.ts`; call `cancel()` on the scheduler instance to stop active work and mark queued attempts cancelled.

## Phase 3 classification and verification

Use `classifyInvestigation()` to aggregate normalized results for every observed test. Infrastructure errors remain outside the valid-attempt denominator. Labels are deliberately limited to `stable within sample`, `suspected flaky`, `consistently failing`, and `inconclusive`; confidence is evidence-based and does not claim statistical proof.

Focused verification is provided by `VerificationService`:

```ts
const result = await new VerificationService(database, docker).run({
  investigationId,
  testId: 'suite:npm-test',
  config: { ...config, repetitions: 50 },
  adapter,
  artifactStore,
});
// result.label: stable within sample | still flaky | inconclusive
```

Verification accepts only 50 or 100 repetitions and reports `inconclusive` when infrastructure errors, cancellation, or incomplete samples prevent a reliable sample conclusion.

## Phase 4 analysis and reports

The analysis service selects at most three failure examples and two passing examples, bounds the evidence text, validates provider output with `TestAnalysisSchema`, and persists the result only after validation. The default `HeuristicAnalysisProvider` is offline and clearly reports limitations rather than claiming a proven root cause.

Generate deterministic report artifacts from persisted state:

```ts
const analysis = await new AnalysisService(database, new HeuristicAnalysisProvider())
  .analyze(investigationId, 'suite:npm-test');
const paths = await writeReports(database, investigationId, 'data/report');
// data/report/report.md and data/report/report.json
```

Reports can be regenerated without rerunning tests. Markdown includes the stability table, counts, flake rates, confidence, hypotheses, observed facts, recommendations, and limitations. JSON contains the same structured aggregates and validated analyses.

## Phase 5 CLI

Build the CLI and use the project intake wizard:

```sh
npm run build
node dist/src/cli/index.js init fixtures/flaky-demo-repo
node dist/src/cli/index.js doctor flaky-hunter.config.json
node dist/src/cli/index.js run --config flaky-hunter.config.json
```

The CLI also provides:

```sh
node dist/src/cli/index.js status <investigation-id>
node dist/src/cli/index.js inspect <investigation-id>
node dist/src/cli/index.js report <investigation-id> --format markdown
node dist/src/cli/index.js report <investigation-id> --format json
```

The database defaults to `data/flaky-hunter.db`; override it with `FLAKY_HUNTER_DB`. `init` detects `npm test` or pytest projects and writes a validated local config. `doctor` checks the repository, Docker daemon, and configured image without running tests.

## Deploy

## Phase 6 local dashboard

Phase 6 adds a lightweight local dashboard without introducing a frontend framework or external runtime service. It serves the persisted investigations, progress, stability aggregates, and analyses through a local Node HTTP server.

Start it from the repository root:

```sh
npm run dashboard
```

Open:

```text
http://127.0.0.1:4173
```

The dashboard polls the local API every five seconds. It shows an empty state when there are no investigations, a clear API error state when the server cannot read the database, investigation cards with progress and failure counts, and a detail view with stability classifications, flake rates, confidence, run progress, and analysis summaries.

The read-only API is available at:

```text
GET /api/health
GET /api/investigations
GET /api/investigations/:id
GET /api/investigations/:id/events
GET /api/investigations/:id/report?format=json|markdown
```

The server binds to `127.0.0.1` by default. Set `HOST`, `PORT`, and `FLAKY_HUNTER_DB` to change local settings. The dashboard does not expose arbitrary filesystem paths or credentials.

There is no hosted deployable service in Phase 6. For a later local deployment, build the image above and publish it to the team's approved registry; do not put registry credentials in this repository.
