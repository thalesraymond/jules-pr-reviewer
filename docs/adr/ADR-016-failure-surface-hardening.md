# ADR-016: Failure-surface hardening, quota detection, and rate-limit-aware retries

## Status
Accepted

## Date
2026-08-09

## Context
The action had no action-level rate limiting (it relied on the `@google/jules-sdk` built-in 429 retry), no concurrency guard (the `concurrency:` block was recommended but left to the user), and a single failure surface: any runtime error hit one catch block that logged `review_failed` with a generic `stage: "review_execution"` and finalized the check run with "Check GitHub Actions log for details." A user who exhausted the 15-sessions/24h free quota got a cryptic error instead of an actionable one. Different failure modes (auth, quota, parse failure, timeout, config) were indistinguishable in logs and on the check run.

## Decision

1. **Failure taxonomy** (`src/errors.ts`): every failure maps to a `FailureKind` — `config` / `auth` / `quota` / `parse` / `timeout` / `unknown`. `classifyFailure` produces a `ReviewFailure` `{ kind, stage, message, summary }`; the summary is the actionable text written to the `jules/review` check run output. Quota and auth failures are also carried as typed errors (`QuotaExceededError`, `AuthError`) so classification is robust to message wording.
2. **Quota detection** (`src/session.ts`): 429 / quota / rate-limit wording is detected at session creation, readiness polling, and review polling, and rethrown as `QuotaExceededError` with an explicit message (free tier allows 15 sessions per 24h — wait for the window or reduce usage). Agentic mode (`src/jules.ts`) skips its prompt-mode fallback on quota because that session would fail the same way.
3. **Distinct exit paths** (`src/index.ts`): config and event-validation errors log `review_failed` with `kind: "config"` and never create a check run; the no-review (timeout) path logs `kind: "timeout"`; the catch block classifies every other error and writes the classified summary to the check run. Parse failures log `kind: "parse"` inside `src/session.ts` and still post the block-verdict fallback review.
4. **Never stale `pending`**: each runtime exit finalizes the check run with a `failure` conclusion; pre-check-run exits never create one. Regression tests assert this per path.
5. **Rate-limit-aware GitHub retries** (`src/resilience.ts`, `src/github.ts`): `isRetryableGithubError` gates `withRetry` on the check-run create/update and thread-resolution GitHub calls so `5xx`/`429`/rate-limit responses retry with backoff while deterministic `401`/`403` auth errors fail fast. The diff fetch keeps its existing compare-then-fallback behaviour.
6. **Concurrency protection is documented, not enforced in-code**: GitHub Actions `concurrency` is the only reliable mutual-exclusion for jobs, so the README gains a clear guide (grouping per PR, `cancel-in-progress` semantics) rather than in-action locking.

## Alternatives Considered

### In-action concurrency lock
- Pros: Works even if users omit `concurrency`
- Cons: GitHub Actions runners are ephemeral — a shared lock needs an external store (issue/check-run mutation), and reusing the same check-run ID lets two runs race on the finalize. GitHub's native `concurrency` key is simpler and correct.
- Rejected: Document and recommend the native mechanism instead (criterion allows "a clear concurrency guide").

### One generic catch block with a single message
- Pros: Minimal code
- Cons: Fails the "actionable, not cryptic" goal for quota exhaustion; root causes invisible in logs
- Rejected: Standardize on the taxonomy.

## Consequences
- Check run failure summaries now name the root cause and next step instead of pointing at the log.
- Quota exhaustion is explicit (429 / session cap) and fails fast in both diff modes.
- GitHub auth errors no longer burn 3 retries; rate limits still back off.
- Structured `review_failed` logs carry `kind`/`stage` for all paths.
- README documents the failure surface and a strengthened `concurrency` guide.
- New error-classification code is covered by unit tests (no Jules session needed); threshold coverage remains ≥90%.
