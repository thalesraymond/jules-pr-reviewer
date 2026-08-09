# ADR-014: Findings deduplication across commits

## Status
Accepted

## Date
2026-08-08

## Context
On `synchronize` events the action diffs only `before → head` (ADR-004) and includes its own marker-tagged open review threads in the prompt so Jules can mark fixed findings as resolved via `resolvedCommentIds`. However, the prompt never instructed Jules *not* to re-report findings that are still open: identical findings re-surfaced across pushes and across runs. CodeRabbit keeps already-commented changes out of re-reviews, and GitHub Copilot review is criticised for repeating dismissed comments.

## Decision
Add a serverless dedupe layer whose source of truth is our own open threads plus the incremental diff — no external storage:

1. **Prompt instruction**: When `dedupe` is enabled and open threads exist, the prompt's trusted "Open Review Comments" section instructs Jules to:
   - **Not re-report** any listed finding in `newComments`.
   - Put a fixed finding's index in `resolvedCommentIds` instead of re-reporting it.
   - Leave unchanged findings alone.
   - Re-report only when the current diff introduces a new or materially different instance of the problem.
2. **Config escape hatch**: New `dedupe` boolean input (default `true`). When `false`, the dedupe instruction is omitted, restoring the old behaviour. The open-thread list is always rendered so `resolvedCommentIds` auto-resolve keeps working in both modes.
3. **Zero-delta scoping**: Already handled by the incremental diff on `synchronize` events; no additional filtering code.

## Alternatives Considered

### Deterministic dedup (body-hash / fuzzy similarity) in TypeScript
- Pros: Fully deterministic, testable without an LLM
- Cons: Findings are semantically comparable; exact/fuzzy matches are brittle and drift as the prompt evolves; duplicates the LLM's own judgement with lower fidelity
- Rejected: Instructing the LLM (which already has the open-thread list in context) is lower-cost and more accurate

### External dedup state (blob/KV per PR)
- Pros: Works across runs even without threads
- Cons: Adds infrastructure, a new failure surface, and secret/permission requirements for a solo-maintained action
- Rejected: Open threads already persist across runs on GitHub; nothing extra is needed

### `dedupe: false` also skips rendering threads
- Pros: Simpler mental model for the escape hatch
- Cons: Silently disables the independent auto-resolve feature
- Rejected: The two capabilities should stay decoupled

## Consequences
- Default behaviour changes: with open threads present, Jules is told not to re-report them. Multi-push PRs should see fewer duplicate comments.
- `dedupe: false` restores the previous behaviour exactly (threads listed, no dedupe instruction).
- `resolvedCommentIds` auto-resolve is unaffected in either setting.
- The instruction is trusted (it is our own prompt); the thread bodies it references are our own bot comments, guarded by the marker + `viewerDidAuthor` checks in `fetchOpenThreads`, so no attacker-controlled content enters that section.
- Prompts are still fully testable without a Jules session (thread fetch + prompt construction unit tests).
