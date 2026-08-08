# Proposal: Findings deduplication across commits (#114)

## Why

On `synchronize`, the action already diffs only `before → head` and the LLM can mark our own open threads as resolved. But identical findings can still re-surface across pushes and across runs: the prompt shows prior open comments but never tells the LLM not to re-report them. Copilot is explicitly criticised for repeating dismissed comments. CodeRabbit keeps already-commented changes out of re-reviews.

We can do this **serverless**: our own marker-tagged open threads + the incremental diff are the source of truth. No external storage.

## What Changes

- **Prompt contract:** The "Open Review Comments" section gains a trusted **Deduplication** instruction when `dedupe` is enabled: Jules MUST NOT re-report its own still-open findings in `newComments`. It should instead mark fixed findings via the existing `resolvedCommentIds` path, and only re-report a finding when the current diff introduces a new or materially different instance of the problem.
- **Config escape hatch:** New `dedupe` boolean input (default `true`). When `false`, the dedupe instruction is omitted — Jules may re-report prior findings. Thread resolution (`resolvedCommentIds`) still works because the open-thread list is always rendered.
- **Zero-delta filtering:** Already satisfied by the existing incremental diff on `synchronize` events (ADR-004) — only the `before → head` delta is ever presented. No new filtering code.

## Capabilities

### New Capabilities
- `findings-dedupe`: The prompt instructs the LLM not to re-report its own still-open findings; configurable via `dedupe` (default on).

### Modified Capabilities

## Impact

- **Files to modify:** `action.yml` (new `dedupe` input), `src/types.ts` (`dedupe` on `CommonPromptArgs`), `src/prompt.ts` (dedupe instruction in `buildThreadsContext`), `src/config.ts` (`dedupe` in `Config`), `src/index.ts` (forward `dedupe` into both prompt builders).
- **Tests to add/modify:** `tests/prompt.test.ts`, `tests/config.test.ts`, `tests/index.test.ts`.
- **Security:** The dedupe instruction is trusted (our own prompt). The thread bodies rendered below it are our own bot comments (marker + `viewerDidAuthor` guarded), so no attacker-controlled content enters this section.
- **No new dependencies.**
- **`dist/index.js` must be rebuilt** after all source changes.
