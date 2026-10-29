# ADR-022: Persist opt-in PR session reuse in review metadata

## Status

Accepted

## Date

2026-10-28

## Context

Issue #205 reports session-creation quotas being consumed by repeated reviews of
the same PR. The Jules SDK supports retrieving sessions by ID, unarchiving, and
sending follow-up messages. Reuse must not accept an old review response or let
an unrelated PR commenter select a session.

## Decision

Default `session_reuse` to false and `session_reuse_max_followups` to five.
Persist ID, follow-up count, and mode in a deterministic hidden marker immediately
after the action marker, before any model-generated text. Only the authenticated
token owner's latest Jules review on this PR is eligible. Paginate all reviews;
do not fall back to an older marker when the latest is ineligible. Failed parsing
never publishes reusable metadata. Changing modes rotates the session, including
when agentic execution falls back to prompt mode.

Keep storage separate from execution policy (ADR-021). The session module owns
reopening, terminal/awaiting-feedback readiness checks, unarchiving, prior activity
ID capture, sending, polling, parsing, and best-effort archiving after adopting a
session. Busy/inaccessible candidates are left untouched. Execution owns
the full current prompt, agentic checkout refresh, and recovery budget. A failed
reuse gets one fresh session: prompt retries in prompt mode; agentic falls back
to prompt mode without a further timeout retry. Reuse quota/auth errors fail fast.
Fresh-session behavior without an eligible reuse candidate is unchanged.

## Alternatives Considered

- Actions cache: immutable cache keys, eviction, runner integration, and branch
  visibility rules add complexity for a tiny piece of already PR-scoped state.
- Arbitrary comment markers: forgeable by PR participants. Authenticate the
  review author and require metadata outside model-generated content instead.
- Leave sessions active until PR closure: requires lifecycle triggers and cleanup
  work beyond this feature; preserve per-review archiving.
- Reuse failed attempts repeatedly: risks accepting a late reply for the wrong
  request. Recover once in a fresh session instead.

## Consequences

- No new dependency or permissions; marker loss or lookup failure starts fresh.
- Serial PR-scoped workflow concurrency remains required. Prefer queued rather
  than cancelled jobs; cancellation cannot guarantee remote cleanup or metadata.
- The follow-up cap bounds conversation growth but cannot eliminate anchoring.
- Quota savings depend on Jules billing/message limits and retention; these are
  not guaranteed by this action or validated by mocked SDK tests.
