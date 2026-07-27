# Design: Jules Retry Resilience

## Context

`runJulesReview` in `src/jules.ts` currently executes a linear sequence:
1. Create Jules session with `customJules.session()`
2. Wait for session readiness via `waitUntilSessionReady()` (404 polling)
3. Poll for review via `pollForReview()` (agentMessaged event, timeout-controlled)
4. Parse response or return null on timeout

When `pollForReview` returns `""` (timeout exhausted), the function returns `{ reviewResult: null, sessionId }` and the action fails. No recovery mechanism exists.

Jules is an external service subject to transient failures. A single retry with a fresh session can recover from temporary outages without user intervention.

## Goals / Non-Goals

**Goals:**
- Add single retry when `pollForReview` returns `""` (timeout only)
- Create fresh session with same prompt and source on retry
- Use full `timeoutMinutes` budget for retry attempt (not halved)
- Emit structured log event (`jules_retry`) with `{ failedSessionId, attempt }` on retry
- Include both session IDs in error message when both attempts timeout
- Skip retry for auth errors (401/403), parse errors, readiness failures

**Non-Goals:**
- Configurable retry count (fixed at 1 retry)
- Retry on non-timeout failures (auth, parse, readiness)
- Changes to `index.ts`, `github.ts`, `prompt.ts`, `types.ts`, or `action.yml`
- Extending total timeout beyond `2 × timeoutMinutes`

## Decisions

### D1: Retry only on `pollForReview` returning `""` (timeout)
**Why:** Timeout is the only transient failure mode. Auth errors (401/403), parse errors, and readiness 404 loops are deterministic — retrying won't help.
**Alternatives considered:** Retry on all errors — rejected; wastes API calls on deterministic failures.

### D2: Fresh session on retry, not reuse same session
**Why:** If a session is stuck internally (e.g., Jules backend issue), more polling won't help. Fresh session gives Jules a clean slate.
**Alternatives considered:** Continue polling same session — rejected; session state may be corrupted or stuck.

### D3: Full `timeoutMinutes` budget for retry attempt
**Why:** User's timeout is per-attempt patience. Splitting the budget reduces effectiveness.
**Alternatives considered:** Split timeout — rejected; reduces per-attempt patience.

### D4: Structured logging with `{ failedSessionId, attempt }`
**Why:** Enables monitoring of retry frequency and correlation with Jules API logs.
**Alternatives considered:** Log only session ID — rejected; need attempt number for metrics.

### D5: Error message includes both session IDs on double-timeout
**Why:** Provides complete audit trail for debugging.

### D6: Retry logic extracted into callable unit inside `runJulesReview`
**Why:** Keeps the retry scope localized to `runJulesReview`. No changes needed to `index.ts`.

## Implementation Pattern

The implementation uses a for-loop inside `runJulesReview` (max 2 iterations):
- Each iteration: create session → wait for readiness → poll for review
- If pollForReview returns a message: parse and return immediately
- If pollForReview returns "" (timeout) AND attempt === 1: log and continue to attempt 2
- If pollForReview returns "" (timeout) AND attempt === 2: throw error with both session IDs
- All other errors (auth, parse, readiness) throw immediately — not caught by retry loop

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Worst-case latency doubles (60 min at default) | User-configurable via `timeoutMinutes` input |
| Extra Jules API invocation (cost) | Single retry is bounded; acceptable for resilience |
| Retry masks underlying Jules issues | Structured logging enables monitoring |

## Migration Plan

- No breaking changes
- No action.yml changes
- No index.ts changes
- `dist/index.js` must be rebuilt (`pnpm build`)

## Open Questions

None. All design decisions were resolved.
