# Proposal: Jules Retry Resilience

## Summary
Add single-retry resilience when Jules times out during review polling. When the first session exhausts its timeout budget without producing a review, automatically create a fresh session with the same prompt and source.

## Motivation
PR authors currently get nothing after a 30-minute wait when Jules times out. The action fails immediately with no recovery mechanism. Transient Jules outages or internal retries cause permanent review loss, forcing manual re-runs. A single retry doubles the chance of success during degraded periods without requiring configuration changes.

## Scope
**Files to modify:**
- `src/jules.ts` — add retry logic to `runJulesReview`
- `tests/jules.test.ts` — add tests for retry behavior
- `docs/adr/ADR-009-jules-retry-resilience.md` — document the decision

**Files NOT modified:**
- `src/index.ts` — no orchestration changes needed
- `src/github.ts` — no GitHub API changes
- `src/prompt.ts` — no prompt changes
- `src/types.ts` — no type changes
- `action.yml` — no new inputs

## Non-Goals
- Configurable retry count (fixed at 1 retry, 2 total attempts)
- Retry on parse errors, auth errors (401/403), or readiness 404 loops
- PR size gates or timeout auto-adjustment
- Changes to error messages for non-timeout failures
- Retry logic in other parts of the codebase

## Security Considerations
- No new untrusted inputs introduced
- Retry only on timeout (deterministic failure mode), not on auth/parse errors
- Structured logging includes session IDs for auditability
- No token scope or permission changes

## Success Criteria
- When Jules times out on first attempt, a fresh session is created automatically
- When both attempts timeout, error message includes both session IDs
- Auth errors (401/403) do not trigger retry
- Parse errors do not trigger retry
- All existing tests continue to pass
- Coverage thresholds (90%) maintained
- Lint, format, build all pass

## OpenSpec Schema
schema: spec-driven
