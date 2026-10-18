# ADR-021: Review execution owns mode policy and completion telemetry

## Status

Accepted

## Date

2026-10-18

## Context

Review execution policy crossed `index.ts`, `executeReview.ts`, and `jules.ts`.
Agentic session outcomes became fallback flags for callers to reinterpret, while
prompt completion duration crossed the interface solely for logging. Prompt
execution emitted `jules_api_called` twice, agentic success emitted none, and an
exhausted prompt timeout was reported as success.

## Decision

The review execution module owns prompt construction, mode selection, prompt
retry, agentic fallback, informational file verification, and completion telemetry.
Its interface returns the review, final session ID, and prompt coverage. Retry and
fallback helpers are internal implementation details. The deep session module
continues to own creation, readiness, polling, parsing, and best-effort archiving.

Keep the existing `jules_api_called` name and `{ success, duration }` payload. Emit
exactly once on every execution exit, with total elapsed milliseconds including
prompt preparation, every attempt, and cleanup, but not GitHub preparation or
submission. Success means a valid parsed review, not an approving verdict or
successful delivery. Null reviews, throws, and unparseable-response fallback
reviews report failure. Retry/fallback diagnostics remain separate.

Preserve ADR-009 retry budgets, ADR-015 coverage, and ADR-016 failure handling.
Preserve current agentic creation-auth fallback, quota fail-fast behavior, and
readiness/polling auth propagation; changing auth policy is separate work.

## Alternatives Considered

- Fix only duplicate logging: leaves fallback interpretation split across modules
  and does not improve locality for joined retry/fallback tests.
- Move single-session lifecycle into execution: leaks SDK complexity into policy
  and discards the existing deep module without gaining leverage.
- Introduce a generic execution framework: no second production adapter or
  distinct policy justifies the extra seam.

## Consequences

- Callers no longer know fallback flags or execution timing details.
- Tests exercise execution through its interface, including joined SDK-seam tests
  for fallback, retry, parsing, cleanup, and event cardinality.
- Log consumers retain the event envelope and fields, but now see corrected
  cardinality, whole-execution duration, and truthful failure outcomes.
- Existing action outputs, verdicts, submission behavior, and session budgets stay
  unchanged; `jules.ts` retains only its existing permission-error guidance.
