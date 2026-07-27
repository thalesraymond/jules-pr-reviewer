# ADR-009: Jules retry resilience for timeout failures

## Status
Accepted

## Date
2026-07-26

## Context
Currently, when Jules times out (pollForReview returns empty string), the action fails immediately with no recovery. The PR author waits up to 30 minutes for nothing. The `runJulesReview` function in `src/jules.ts` creates a single session and polls for `timeoutMinutes`. If the polling loop exhausts the budget without receiving an `agentMessaged` event, `pollForReview` returns `""`, and the action reports failure.

Jules is an external service subject to transient outages, resource contention, or internal retries. A single 30-minute window may be insufficient during degraded periods. Without retry logic, transient failures cause permanent review loss, forcing manual re-runs.

## Decision
Add a single retry in `runJulesReview` inside `src/jules.ts`:
- When `pollForReview` returns `""` (timeout only — NOT auth errors, parse errors, or readiness failures), create a fresh Jules session with the same prompt and source
- The retry uses the full `timeoutMinutes` budget (not halved)
- If the retry also times out, fail with an error message listing both session IDs
- Emit a `core.info` line and a structured log event (`jules_retry`) with `{ failedSessionId, attempt }` when retrying
- All other failure modes (auth 401/403, parse errors, readiness 404 loops) are NOT retried because they're deterministic

The retry logic extracts the session creation + readiness polling + review polling sequence into a callable unit, attempted at most twice.

## Alternatives Considered

### Reuse same session
- Pros: No extra API call, simpler implementation
- Cons: If session is stuck internally, more polling won't help; session state may be corrupted
- Rejected: Fresh session gives Jules a clean slate

### Configurable retry count
- Pros: Teams can tune resilience vs. cost
- Cons: Adds complexity to action.yml and index.ts; if 2 sessions fail, a 3rd won't help
- Rejected: Single retry captures most transient failures without configuration burden

### Extend polling first then fresh session
- Pros: Maximizes single-session patience
- Cons: 30 min of polling already exhausted; extending further delays retry
- Rejected: User's timeout is per-attempt patience; retry should be immediate

### Split timeout budget (e.g., 15 min × 2 attempts)
- Pros: Same total latency, two chances
- Cons: Each attempt has reduced patience; transient 20-min outage fails both
- Rejected: User's timeout is per-attempt patience; splitting reduces effectiveness

### Retry on all errors
- Pros: Uniform error handling
- Cons: Auth/parse errors are deterministic; retrying wastes time and API calls
- Rejected: Only timeout benefits from retry; other errors need different remediation

## Consequences
- **Positive:** Doubles effective timeout, handles transient Jules outages
- **Positive:** No new inputs, no action.yml changes, no index.ts changes
- **Positive:** Structured logging enables monitoring of retry frequency
- **Negative:** Worst-case latency doubles (60 min at default 30-min timeout)
- **Negative:** Extra Jules API invocation on retry (cost implication)
- **Implementation:** `runJulesReview` in `src/jules.ts` refactored to extract retryable unit
- **Testing:** `tests/jules.test.ts` adds cases for: first fails/second succeeds, both fail, auth errors skip retry
- **Documentation:** This ADR recorded in `docs/adr/`
