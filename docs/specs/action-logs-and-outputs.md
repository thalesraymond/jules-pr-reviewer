# Spec: Action Logs and Outputs

## Problem Statement

Consumers of the `jules-pr-reviewer` action have limited visibility into its runtime behaviour. Logs are human-readable but not machine-readable, so log aggregators and callers cannot parse review verdicts, durations, or issue counts. Downstream workflows cannot react to review results because the action emits no outputs — they would have to parse the PR comment. Teams cannot troubleshoot, automate, or build dashboards around the review pipeline.

## Solution

Add a small, dependency-free structured-logging layer and a stable set of GitHub Action outputs. The logging helper serializes JSON payloads prefixed `::structured::` and writes them through `@actions/core`, instrumenting key lifecycle milestones and Jules API calls. The action emits outputs for the verdict, issue counts by severity, and the Jules session ID — in success, failure, and skip paths — so downstream steps can branch on results. All emitted data passes through a scrubbing layer so secrets and untrusted PR inputs never leak.

## User Stories

1. As a workflow author, I want the review verdict exposed as an action output, so that downstream steps can branch on approve/comment/block.
2. As a workflow author, I want issue counts exposed as outputs, so that I can gate or report on the number and severity of findings.
3. As a workflow author, I want the Jules session ID exposed as an output, so that I can reference the session for debugging.
4. As a workflow author, I want outputs defined even when a review is skipped (draft, fork, or bypass label), so that downstream steps never receive undefined values.
5. As an action maintainer, I want structured JSON log events at lifecycle milestones, so that log aggregators can parse review behaviour.
6. As an action maintainer, I want a `review_started` event with repository context and head SHA, so that runs are traceable.
7. As an action maintainer, I want a `review_completed` event with verdict, severity counts, session ID, and duration, so that review outcomes are machine-readable.
8. As an action maintainer, I want a `review_failed` event with an error reason and last completed stage, so that failures are diagnosable.
9. As an action maintainer, I want a `jules_api_called` event with duration and outcome, so that Jules API latency is observable.
10. As an action maintainer, I want secrets (API key, GitHub token) masked before reaching the log stream, so that credentials never leak.
11. As an action maintainer, I want raw untrusted PR content (diff, title, description) kept out of logs and outputs, so that prompt-injection payloads are not echoed into machine-readable data.
12. As an action maintainer, I want the capability to rely only on `@actions/core` and standard Node APIs, so that the dependency footprint stays lean.
13. As a workflow author, I want log bloat kept low (one structured line per major stage), so that the GitHub UI log stays readable.

## Implementation Decisions

### Custom structured-logging helper instead of a third-party logger

`@actions/core` already provides the primitives needed (`core.info`, `core.error`, `core.setSecret`, `core.setOutput`). A thin wrapper keeps the bundle small, respects existing formatting rules, and avoids conflicting with Actions log groups and annotations. No new dependency is added.

### `::structured::` prefix via `core.info`

Structured entries are JSON serialized, prefixed `::structured::`, and emitted through `core.info`. The stable prefix lets consumers parse events from the run log with simple text matching while keeping the entry visually identifiable, without interfering with `::group::`, `::error::`, or other Actions commands.

### Logging and output helpers in a dedicated module

Log setup, structured logging, and output helpers live in their own module, isolating the capability (Single Responsibility Principle), centralizing secret scrubbing, and creating a clear test surface. Instrumentation points in the orchestrator stay concise.

### Counts computed from the parsed review result

Issue counts are computed from the parsed review result so they reflect the same data used to submit the review, keeping the outputs consistent with what was sent to GitHub.

### Outputs set in every exit path

Outputs are set inside the main flow and in the early-skip branches, so workflows referencing `steps.jules.outputs.verdict` always receive a defined value — drafts, forks, and bypass labels yield `verdict: skipped` and zero counts.

### Recursive secret scrubbing

Before emission, payloads are recursively scrubbed: the GitHub token and Jules API key values are masked, and known untrusted fields (diff text, PR title, PR description) are redacted. `core.setSecret` is still called on inputs as before.

## Testing Decisions

- **What makes a good test:** Test the emitted behaviour — structured log payloads (shape and scrubbing), action output values in success and skip paths, and the dependency surface — by spying on `@actions/core` functions, without exercising the real pipeline.
- **Modules under test:**
  - `logging.ts` — structured event emission, `::structured::` prefix, recursive secret scrubbing (token, API key, untrusted fields redacted).
  - `index.ts` — outputs set in success and skip (draft/fork/bypass) paths.
  - `action.yml` — output declarations.
- **Prior art:** `tests/logging.test.ts` already asserts structured events and scrubbing against a mocked `@actions/core`; `tests/index.test.ts` asserts orchestrator behaviour including skip branches via mocked helpers.

## Out of Scope

- Reformatting or enhancing the PR review comment output.
- Remote metrics, dashboards, or external observability integrations.
- Changing the prompt or the Jules review model behaviour.
- Configurable log levels or verbose modes.
- Exposing the free-text review summary as an output (only categorical verdict, counts, and session ID are surfaced).
- Adding a `review_url` output (the action does not currently retain the submitted review URL).

## Further Notes

- The scrubber redacts against the same secret envelope (`core.setSecret` plus the `process.env.JULES_API_KEY` / `process.env.GITHUB_TOKEN` writes) used elsewhere in the action.
- Outputs are documented in the README and `action.yml` as a stable, additive surface; breaking changes would be signalled separately.
- See ADR-006 for the structured-logging decision record and ADR-013 for the GitHub Checks API status reporting.
