# Spec: Findings Deduplication

## Problem Statement

On `synchronize` events the action diffs only `before → head` and lets the LLM mark its own open threads as resolved. But identical findings still re-surface across pushes and across runs: the prompt shows prior open comments but never tells the LLM not to re-report them. Maintainers get duplicate comments on multi-push PRs, and dismissed or already-fixed findings keep being re-reported.

## Solution

Add a serverless dedupe layer whose source of truth is the action's own marker-tagged open threads plus the incremental diff — no external storage. A new `dedupe` boolean input (default `true`) adds a trusted prompt instruction: Jules must not re-report its own still-open findings in `newComments`, must route fixed findings through the existing `resolvedCommentIds` path, and may only re-report when the current diff introduces a new or materially different instance. Setting `dedupe: false` omits the instruction, restoring the old behaviour while keeping thread resolution working.

## User Stories

1. As a maintainer, I want the reviewer to stop re-reporting its own still-open findings on subsequent pushes, so that multi-push PRs stay free of duplicate comments.
2. As a maintainer, I want dedupe to work without external storage, so that there is no new infrastructure to operate.
3. As a maintainer, I want a `dedupe` input that defaults to `true`, so that the improvement is on out of the box.
4. As a maintainer, I want to disable dedupe with `dedupe: false`, so that a full re-review is possible when wanted.
5. As a maintainer, I want the open-thread list always rendered regardless of the `dedupe` setting, so that the `resolvedCommentIds` auto-resolve capability keeps working in both modes.
6. As a maintainer, I want a fixed finding's index routed into `resolvedCommentIds` instead of being re-reported, so that resolved threads are actually closed.
7. As a maintainer, I want unchanged findings left alone rather than repeated, so that stale issues are not re-raised.
8. As a maintainer, I want a new comment allowed when the current diff introduces a new or materially different instance of a problem, so that real regressions are not suppressed.
9. As a maintainer, I want an invalid `dedupe` value to fail with a clear error message, so that misconfiguration surfaces fast.
10. As a maintainer, I want zero-delta scoping to be satisfied by the existing incremental diff on `synchronize` events, so that already-reviewed changes are never re-presented.

## Implementation Decisions

### Instruct the LLM, don't compute duplicates ourselves

Findings are LLM-generated and semantically comparable; deterministic dedup (body hash or fuzzy similarity) in TypeScript would be brittle and high-maintenance. The LLM already receives the open-thread list, so a precise trusted instruction is the lowest-cost, most reliable signal. Serverless by construction — no state beyond GitHub threads.

### `dedupe` controls only the instruction, not the thread list

The open-thread list serves two purposes: dedupe context AND `resolvedCommentIds` resolution. Turning `dedupe` off should let the LLM re-report if it chooses, without breaking the independent auto-resolve feature. Rendering the list always keeps the two features decoupled.

### `dedupe` is a defaulted boolean on the shared prompt args

The prompt builder behaves consistently when constructed without an explicit flag, and the default matches the config default so the feature is on out of the box.

### Re-reporting is allowed for materially new instances

A new commit can legitimately re-introduce or worsen the same class of problem in a different spot. The instruction scopes non-duplication to unchanged findings and permits new comments for materially different instances.

## Testing Decisions

- **What makes a good test:** Test the prompt contract — dedupe instruction present when `dedupe` is true or omitted (default), absent when `dedupe` is false, open-thread list always rendered, and no threads → no dedupe section — plus the config parsing and input forwarding, without invoking the LLM.
- **Modules under test:**
  - `prompt.ts` — dedupe instruction in the threads context builder; default to `true` in the prompt builder.
  - `config.ts` — `dedupe` default true, `dedupe: false` parsed, invalid boolean fails.
  - `index.ts` — `dedupe` forwarded into prompt construction for prompt mode.
  - `types.ts` — optional `dedupe` on the shared prompt args.
- **Prior art:** `tests/prompt.test.ts` asserts prompt text content for mode/threads variations; `tests/config.test.ts` asserts input parsing and defaults; `tests/index.test.ts` asserts flag forwarding via mocked helpers. The new cases extend these existing patterns.

## Out of Scope

- Cross-run persistent storage or caching of reviews.
- Deduplicating by diff-hash or comment-body similarity (LLM-instructed dedupe only).
- Per-file zero-delta filtering beyond the existing incremental diff.
- Thread-resolution changes — `resolvedCommentIds` behaviour is unchanged and orthogonal.

## Further Notes

- The dedupe instruction is trusted (our own prompt). The thread bodies rendered below it are the action's own bot comments (marker-tagged and `viewerDidAuthor`-guarded), so no attacker-controlled content enters this section.
- The security model is unchanged: the reviewed PR's title, description, diff, and rules file remain UNTRUSTED.
- See ADR-014 for the architectural decision record of this capability.
