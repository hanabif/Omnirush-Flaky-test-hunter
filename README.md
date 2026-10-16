# Flaky Tests Hunter

Flaky Tests Hunter is an evidence-first tool for repeating tests in isolated environments, separating test failures from infrastructure failures, and producing actionable investigation reports.

## Phase 1 status

This branch contains the Phase 0 foundation plus the first one-run execution path:

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

Scheduling, analysis providers, reporting, and the dashboard are intentionally deferred to later phases.

## Requirements

- Node.js 22.14.0 (use `nvm use` with `.nvmrc` where available)
- npm 10+
- Docker Engine or Docker Desktop for the container build

## Setup

```sh
npm ci
cp .env.example .env
```

No credentials are required for Phase 1.

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

## Deploy

There is no deployable service in Phase 0. For a later local deployment, build the image above and publish it to the team's approved registry; do not put registry credentials in this repository.
