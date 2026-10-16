# Flaky Tests Hunter

Flaky Tests Hunter is an evidence-first tool for repeating tests in isolated environments, separating test failures from infrastructure failures, and producing actionable investigation reports.

## Phase 0 status

This branch contains the deterministic foundation described by the architecture plan:

- strict TypeScript project with Node.js 22 pinned in `.nvmrc`;
- Zod schemas for investigation configuration, runs, normalized results, events, and analysis responses;
- pure flakiness classification rules that exclude infrastructure errors;
- SQLite persistence using Node's built-in `node:sqlite` API;
- bounded artifact storage and secret-redacting structured logging primitives;
- deterministic demo fixture modes for stable, failing, flaky, timeout, and order-dependent behavior.

Docker execution, scheduling, runner adapters, analysis providers, and the dashboard are intentionally deferred to later phases.

## Requirements

- Node.js 22.14.0 (use `nvm use` with `.nvmrc` where available)
- npm 10+
- Docker Engine or Docker Desktop for the container build

## Setup

```sh
npm ci
cp .env.example .env
```

No credentials are required for Phase 0.

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

## Docker

Build and run the reproducible Phase 0 checks:

```sh
docker build -t flaky-tests-hunter:phase-0 .
docker run --rm flaky-tests-hunter:phase-0
```

The Docker image installs dependencies from the committed lockfile and runs the same test command as `make test`.

## Deploy

There is no deployable service in Phase 0. For a later local deployment, build the image above and publish it to the team's approved registry; do not put registry credentials in this repository.
