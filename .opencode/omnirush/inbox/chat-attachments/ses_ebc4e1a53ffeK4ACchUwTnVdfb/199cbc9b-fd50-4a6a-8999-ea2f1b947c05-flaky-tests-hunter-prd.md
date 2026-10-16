# Flaky Tests Hunter — Product Requirements Document

**Status:** Draft v0.1  
**Product:** Flaky Tests Hunter  
**Audience:** Buildathon judges, engineering teams, and contributors  

## 1. Summary

Flaky Tests Hunter is a developer tool that detects tests whose results are not deterministic, identifies likely causes, and proposes practical fixes. A user points the tool at a repository, selects or confirms the test command, and starts an investigation. The tool runs the suite repeatedly in isolated Docker containers, records structured evidence for every attempt, identifies tests with inconsistent outcomes, and assigns each flaky test an analysis sub-agent.

The product is successful when it turns an unexplained intermittent CI failure into a reproducible report containing the affected test, failure frequency, environment details, useful logs, a likely root-cause category, and a suggested remediation.

## 2. Problem

CI failures are not always caused by a code regression. Timing, shared state, test ordering, random data, network dependencies, resource contention, and environment differences can cause a test to fail intermittently.

Teams commonly respond by re-running CI until it passes. This hides the underlying defect, consumes engineering time, and gradually reduces trust in the CI signal. Most teams do not investigate because proving flakiness requires many test executions, consistent logging, and isolation that are difficult to set up manually.

## 3. Goals

### Primary goals

1. Make repeated test execution easy for an existing repository.
2. Detect tests whose outcomes vary across repeated runs.
3. Preserve enough evidence to reproduce and investigate each failure.
4. Analyze each suspected flaky test independently with an AI sub-agent.
5. Produce an actionable report with likely causes and suggested fixes.
6. Require a configurable confidence threshold before labeling a test stable or flaky.

### Secondary goals

1. Run investigations in parallel to reduce wall-clock time.
2. Support common test runners through a pluggable adapter model.
3. Make results exportable for CI artifacts or issue tracking.
4. Provide a clear path from a local investigation to future CI integration.

## 4. Non-goals for the MVP

The MVP will not:

- Automatically modify production code or merge a fix.
- Guarantee the true root cause of every flaky test.
- Replace a team's CI provider.
- Support arbitrary operating systems inside one investigation.
- Execute untrusted repository code outside an explicitly isolated container.
- Detect all infrastructure-only failures unrelated to test behavior.
- Maintain a long-term organization-wide flake history or quarantine policy.

## 5. Target users and use cases

### Primary persona: Application developer

Needs to understand why a test fails only occasionally and wants a local command that produces evidence without manually rerunning the suite.

### Secondary persona: CI/platform engineer

Needs to validate whether a suspicious test is flaky, compare execution environments, and export a report for a pull request or issue.

### Core use cases

1. **Investigate a whole suite:** Point the tool at a repository and run the configured suite 50 or 100 times.
2. **Investigate a single test:** Run one test repeatedly while iterating on a suspected race or state leak.
3. **Compare conditions:** Repeat runs with different order seeds, worker counts, or isolation settings.
4. **Understand a suspected flake:** Read the test-specific evidence and AI-generated hypotheses.
5. **Share findings:** Export a human-readable report and machine-readable JSON.

## 6. Product principles

- **Evidence before explanation:** AI conclusions must cite observed runs, logs, diffs, and environment facts.
- **Isolation by default:** Repository code runs in disposable, resource-limited containers.
- **Determinism where possible:** Record seeds, ordering, versions, timestamps, and configuration for every run.
- **Honest confidence:** Distinguish observed behavior from hypotheses and do not claim a fix was verified unless it was rerun.
- **Useful failure:** A partial investigation should still produce logs, status, and an explanation of what was not completed.

## 7. MVP scope

### In scope

- Repository path or Git URL input.
- Docker-based execution.
- A configurable test command, timeout, repetition count, and concurrency limit.
- Test-runner output capture with a normalized result format.
- Repeated execution in isolated containers.
- Per-test outcome aggregation.
- Detection of inconsistent outcomes.
- Run metadata capture: image, command, seed, order, duration, exit code, resource errors, and timestamps.
- Parallel investigation workers.
- One analysis sub-agent per suspected flaky test, with bounded context and a structured response.
- Dashboard or CLI report showing progress and final findings.
- Markdown and JSON export.
- A verification mode that reruns the suspected test 50 or 100 consecutive times and reports whether it remained stable.

### Initial test-runner targets

The adapter interface should be designed for multiple runners. The first implementation should support one or two runners that are practical for the buildathon, selected based on the repository and team expertise. Recommended initial targets are:

- JavaScript/TypeScript: `npm test` or a configured command.
- Python: `pytest`.

Additional runners should be added through adapters rather than special cases in the orchestration core.

## 8. User experience

### Investigation flow

1. User enters a repository path or URL.
2. Tool detects the project type and proposes a test command.
3. User sets repetitions, concurrency, timeout, Docker image, and optional seed/order settings.
4. Tool validates Docker availability and performs a short smoke test.
5. User starts the investigation.
6. Tool displays queued, running, passed, failed, timed-out, and infrastructure-error runs.
7. As inconsistent tests emerge, the tool creates test-specific analysis jobs.
8. User opens a test result to see evidence, likely causes, and recommendations.
9. User exports the report or reruns a focused verification campaign.

### Key report views

- Investigation overview and completion status.
- Test stability table: test name, pass count, fail count, timeout count, flake rate, confidence, and status.
- Test detail: first failing and passing runs, normalized failure messages, logs, diffs, seeds, order, and environment.
- AI analysis: observed facts, hypotheses, evidence links, recommended next steps, and confidence.
- Export controls for Markdown and JSON.

## 9. Functional requirements

### FR-1: Project intake

The system must accept a local repository path. The architecture should allow a Git URL in a later iteration. It must validate that the repository exists and that the selected Docker execution mode is available.

### FR-2: Test command configuration

The user must be able to specify the test command, working directory, environment variables, test filter, timeout, repetition count, concurrency, and container image. Secrets must be passed through protected runtime configuration and must not be written to reports.

### FR-3: Safe execution

Each attempt must execute in a disposable container with a defined working directory, resource limits, timeout, network policy, and mounted repository contents. The default mode should minimize network access and never mount the host Docker socket.

### FR-4: Reproducible run records

Every attempt must record a unique ID, investigation ID, test command, container image digest or tag, repository revision when available, start/end time, duration, exit status, timeout/resource status, seed/order variables, stdout/stderr references, and normalized test results.

### FR-5: Parallel scheduling

The scheduler must enforce the configured concurrency limit and must not start more jobs than available capacity. A failed worker must not silently lose a run; the run must be marked as failed or infrastructure-error and remain visible.

### FR-6: Flakiness classification

The system must classify a test as suspected flaky when the same test has at least one successful and one unsuccessful outcome within the investigation. The report must distinguish test failures, timeouts, crashes, and infrastructure errors.

The classification must show sample size and confidence. A single inconsistent result is evidence of nondeterminism, not proof of a root cause.

### FR-7: Analysis sub-agents

Each suspected flaky test must receive a bounded analysis task containing the relevant source, test configuration, normalized failures, selected passing and failing logs, run metadata, and repository diff or revision context when available.

The sub-agent must return structured fields:

- Observed facts.
- Most likely cause category.
- Supporting evidence.
- Alternative hypotheses.
- Recommended fix.
- Suggested verification command.
- Confidence and limitations.

### FR-8: Verification campaign

The user must be able to run a focused campaign for a selected test. The tool must support at least 50 and 100 consecutive attempts, with a clear result such as `stable within sample`, `still flaky`, or `inconclusive due to infrastructure errors`.

### FR-9: Reporting and export

The system must provide a live progress view and final report. It must export Markdown for humans and JSON for automation. Reports must include the tool version and investigation configuration.

### FR-10: Cancellation and recovery

The user must be able to cancel an investigation. Running containers should be stopped, queued work should be marked cancelled, and completed evidence should remain available. The system should support resuming incomplete work where feasible.

## 10. Non-functional requirements

### Security

- Run repository code in containers with least privilege.
- Apply CPU, memory, process-count, disk, and wall-clock limits.
- Do not expose host credentials or the Docker socket.
- Redact configured secrets from logs and AI context.
- Treat repository content and test output as untrusted input.
- Prevent analysis agents from executing commands unless explicitly mediated by the orchestrator.

### Reliability

- No completed run may disappear because a worker or UI process failed.
- The system must distinguish product errors from test failures.
- A report must be generated even when some attempts fail to start.

### Performance

- Runs should execute concurrently up to the configured limit.
- The scheduler should avoid loading all raw logs into memory.
- The UI should show progress without polling every container directly.

### Portability

- The core result schema must be test-runner independent.
- The CLI should work on environments with Docker Desktop or a compatible Docker Engine.

## 11. Success metrics

### MVP success criteria

1. A user can configure and start an investigation in under five minutes.
2. At least 90% of completed attempts have a complete normalized run record.
3. Parallel execution achieves materially lower wall-clock time than serial execution for the same workload.
4. A deliberately flaky sample test is detected reliably in a 50-run campaign.
5. A deliberately stable sample test is not labeled flaky when all attempts pass.
6. The report identifies the correct broad cause category for the demo scenarios often enough to be useful, while clearly exposing uncertainty.

### Longer-term metrics

- Time from CI failure to actionable diagnosis.
- Percentage of investigated flakes with a confirmed fix.
- Repeat usage per repository.
- False-positive rate for flaky classification.

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Test suite is too slow for 50–100 runs | Poor user experience | Support focused test selection, parallelism, early evidence, and configurable campaigns |
| Docker is unavailable or misconfigured | Investigation cannot start | Preflight validation and clear remediation messages |
| Network-dependent tests behave differently | Misleading results | Record network policy; allow explicit opt-in; label environment-dependent findings |
| AI produces confident but incorrect explanations | Developers make bad fixes | Require cited evidence, confidence, alternatives, and human verification |
| Logs contain secrets or sensitive data | Security/privacy incident | Redaction, bounded context, configurable retention, and no secret injection by default |
| Infrastructure failures look like flaky tests | False positives | Separate infrastructure status from test outcome and exclude infra errors from the flake denominator |
| Parallel execution changes behavior | Incomplete diagnosis | Record worker count/order and offer serial or controlled-order modes |

## 13. Open questions

1. Is the buildathon deliverable CLI-first, web UI-first, or both?
2. Which test runner will be the first-class demo target?
3. Should repositories be local-only for the MVP, or should Git URLs be included?
4. Which model/provider is available for analysis, and what is the cost/latency budget?
5. Should the tool use a persistent database, or is a file-backed investigation store sufficient for the demo?
6. What network policy should be the default for test containers?

## 14. MVP acceptance criteria

The MVP is complete when all of the following are true:

- A sample repository can be investigated through a documented command or UI flow.
- At least 50 repeated attempts can run in Docker with a configurable concurrency limit.
- The tool detects a sample test that alternates between pass and fail.
- It does not confuse container startup failures with test failures.
- A user can inspect the evidence for a suspected flaky test.
- An analysis sub-agent returns a structured explanation grounded in that evidence.
- A 50- or 100-run focused verification produces an explicit stability result.
- Markdown and JSON reports can be saved outside the running process.
- The project includes a reproducible demo repository or fixture suite and automated checks for the core classifier and scheduler.
