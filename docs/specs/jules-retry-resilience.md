# Spec: Jules Retry Resilience

## Problem Statement

When Jules times out during review polling, PR authors get nothing after a long wait: the action fails immediately with no recovery mechanism, and the review is lost. Transient Jules outages or slow internal retries cause permanent review loss on PRs that might otherwise have succeeded, forcing manual re-runs.

## Solution

Add single-retry resilience to the Jules review pipeline. When the first session exhausts its `timeoutMinutes` budget without producing a review, the action automatically creates a fresh session with the same prompt and source and runs it with the full timeout budget. A single retry doubles the chance of success during degraded periods. Retries are triggered exclusively on timeout — auth errors, parse errors, and readiness 404 loops still fail immediately without retrying.

## User Stories

1. As a PR author, I want the review to be retried once when Jules times out, so that a transient outage does not silently lose my review.
2. As a PR author, I want the retry to use the full `timeoutMinutes` budget, so that the second attempt is not unfairly truncated.
3. As a PR author, I want the action to return the review from the second session when the first one times out, so that I get a completed review instead of a failure.
4. As a PR author, I want no retry to happen when the first attempt succeeds, so that reviews are never duplicated or slowed down.
5. As a maintainer, I want auth errors (401/403) to fail immediately without retrying, so that a misconfigured API key surfaces fast rather than being masked by a retry.
6. As a maintainer, I want parse errors to return a fallback review result without retrying, so that invalid LLM output does not spawn a wasteful second session.
7. As a maintainer, I want readiness failures (404 polling loop) to fail without retrying, so that an unreachable session does not get retried pointlessly.
8. As a maintainer, I want the error message to include both session IDs when both attempts time out, so that the failure is auditable.
9. As a maintainer, I want structured logging when a retry is triggered, so that retry activity is machine-readable.
10. As a maintainer, I want no retry-related log events when the first attempt succeeds, so that successful runs stay clean.
11. As a maintainer, I want the retry logic to be internal to the review pipeline, so that no new action inputs or type fields are added.
12. As a PR author, I want the error to indicate that 2 attempts were made when both time out, so that I understand what happened.

## Implementation Decisions

### Retry is internal to the review pipeline

The retry logic lives entirely inside the review-runner module (`jules.ts`). No new inputs are added to `action.yml`, `index.ts` requires no orchestration changes, and no new fields are added to the shared type definitions. The retry count is fixed at one retry (two total attempts); it is not configurable.

### Timeout is the only retry trigger

A timeout is defined as the polling function returning an empty string (`""`) after exhausting the `timeoutMinutes` budget. That deterministic signal is the sole trigger. Non-timeout failures — auth errors, parse errors, and readiness 404 loops — each have their own existing failure path and are not retried.

### The retry uses a fresh session with the full budget

On timeout the action creates a fresh session with the same prompt and source and polls with the full `timeoutMinutes` budget (not halved). If both attempts time out, the raised error message includes both session IDs and states that 2 attempts were made.

### Structured logging on retry

A retry emits a `core.info` line plus a structured log event carrying `{ failedSessionId, attempt }`. No retry-related events are emitted when the first attempt succeeds.

## Testing Decisions

- **What makes a good test:** Test the retry decision — one retry on timeout, no retry on success/auth/parse/readiness failures, the full-budget second attempt, the both-timeout error message containing both session IDs — without exercising the real Jules API.
- **Modules under test:**
  - `jules.ts` — `runJulesReview` retry behavior against a mocked `runSession` from `session.ts`.
- **Prior art:** `tests/jules.test.ts` already mocks `runSession` and asserts review outcomes and error messages; the retry cases extend the same mock boundary (`vi.fn()` on `runSession`) and add assertions for the retry-emitted log events.

## Out of Scope

- Configurable retry count (fixed at one retry).
- Retries on parse errors, auth errors (401/403), or readiness 404 loops.
- PR-size gates or automatic timeout adjustment.
- Changes to error messages for non-timeout failures.
- Retry logic in any other part of the codebase (e.g. GitHub API calls, submission).

## Further Notes

- The resilience module (`src/resilience.ts`) already provides `withRetry`/`withFallback` primitives for transient and permanent API failures; the timeout-retry lives in the review pipeline where the timeout signal originates.
- See ADR-009 for the architectural decision record of this capability.
