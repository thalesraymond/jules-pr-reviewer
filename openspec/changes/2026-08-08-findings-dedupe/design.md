# Design: Findings deduplication across commits (#114)

## Context

The action already fetches its own marker-tagged open threads (`fetchOpenThreads`) and renders them in the prompt (`buildThreadsContext`) so the LLM can mark fixed findings via `resolvedCommentIds`. On `synchronize` events it presents only the incremental diff (`before → head`, ADR-004).

The gap: the prompt never instructs the LLM not to re-report findings that are still open. Identical findings re-surface across pushes and across runs. CodeRabbit and Copilot review both avoid repeating already-commented changes; users now expect this.

## Goals / Non-Goals

**Goals:**
- Serverless dedupe: own open threads + incremental diff are the source of truth; no external storage.
- Trusted prompt instruction not to re-report still-open findings.
- `dedupe` config escape hatch (default on) for users who want a full re-review.
- Documented behaviour in README + an ADR.

**Non-Goals:**
- Cross-run persistent storage or caching of reviews.
- Deduplicating by diff-hash or comment-body similarity (LLM-instructed dedupe only).
- Per-file zero-delta filtering beyond the existing incremental diff.

## Decisions

### D1: Instruct the LLM, don't compute duplicates ourselves

**Why:** The findings are LLM-generated and semantically comparable; exact-match or fuzzy-dedup in TypeScript would be brittle and high-maintenance. The LLM already receives the open-thread list, so a precise trusted instruction is the lowest-cost, most reliable signal. Serverless by construction — no state beyond GitHub threads.

**Alternatives considered:** Deduping by normalized body hash or fuzzy similarity in `index.ts` — rejected; false positives/negatives are hard to control and it duplicates logic the LLM already does when instructed. External KV/blob dedup — rejected; adds infra and a new failure surface for marginal gain.

### D2: `dedupe` controls only the instruction, not the thread list

**Why:** The open-thread list serves two purposes: dedupe context AND `resolvedCommentIds` resolution. Turning `dedupe` off should let the LLM re-report if it chooses, without breaking the independent auto-resolve feature. Rendering the list always keeps the two features decoupled.

**Alternatives considered:** `dedupe: false` skips fetching/rendering threads entirely — rejected; silently disables auto-resolve, which is a separate, desired capability.

### D3: `dedupe` is a required boolean on `CommonPromptArgs`, defaulted to `true` in `buildReviewPrompt`

**Why:** The prompt builder should behave consistently when constructed without an explicit flag (existing tests/callers), and the default must match the config default so the feature is on out of the box.

**Alternatives considered:** Making it required everywhere — rejected; churns every existing test call site for no behavioural benefit.

### D4: Re-reporting is allowed for materially new instances

**Why:** A new commit can legitimately re-introduce or worsen the same class of problem in a different spot. Blanket "never re-report" would miss real regressions. The instruction therefore scopes non-duplication to unchanged findings and permits new comments for materially different instances.

## Consequences

- Default behaviour changes: with open threads present, the LLM is told not to re-report them. Expected reduction in duplicate comments on multi-push PRs.
- `dedupe: false` restores old behaviour exactly (open threads listed, no dedupe instruction).
- `resolvedCommentIds` auto-resolve is unaffected in both settings.
- The 90% coverage threshold applies to the new config/prompt branches; tests added for both `dedupe` on/off.
- `dist/index.js` must be rebuilt.
