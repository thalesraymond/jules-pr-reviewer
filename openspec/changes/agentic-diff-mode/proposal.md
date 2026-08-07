# Proposal: Agentic Diff Mode

## Why

The current prompt-mode pipeline embeds the entire PR diff as a fenced code block in the Jules prompt. This works for small diffs but hits hard limits at 80 KB and offers no structural awareness — Jules sees a flat text blob, not a tree of files. An agentic diff mode lets Jules inspect the PR head branch directly (`git diff <base_sha>...HEAD`), giving it full repository context and removing the diff-size ceiling entirely.

## What Changes

- New `diff_mode` input (`prompt` | `agentic`, default `prompt`) controls which review pipeline runs.
- **Agentic prompt contract:** Jules receives SHA-based diff instructions (`git diff <base_sha>...HEAD`) with branch-ref fallback, a read-only security prohibition, merged `ignored_paths` with `.gitignore`, a soft nudge for >50-file PRs, and an optional `changedFiles: string[]` field in `ReviewResult`.
- **Fallback state machine:** Session-creation failure and timeout both trigger immediate prompt-mode fallback (no agentic retry). Verification mismatches (empty/partial `changedFiles`) also trigger fallback; extra-only mismatches warn and proceed. Abandoned agentic sessions are archived best-effort.
- **Session lifecycle:** Every session the action creates is archived (best-effort) once done, keeping the user's Jules list clean.
- `parseReviewResponse` gains optional `changedFiles` field handling.

## Capabilities

### New Capabilities
- `agentic-diff-mode`: The agentic review pipeline — prompt contract, fallback state machine, session lifecycle, and changedFiles verification.

### Modified Capabilities

## Impact

- **Files to modify:** `action.yml` (new input), `src/types.ts` (DiffMode type, changedFiles in ReviewResult), `src/prompt.ts` (agentic prompt template), `src/jules.ts` (agentic session config, fallback logic, archive policy), `src/index.ts` (mode branching, changedFiles verification), `src/validation.ts` (changedFiles optional field).
- **Tests to add/modify:** `tests/prompt.test.ts`, `tests/jules.test.ts`, `tests/index.test.ts`, `tests/validation.test.ts`.
- **Security:** Prompt-injection defence extended — agentic prompt labels diff instructions as UNTRUSTED. Read-only prohibition added. No token-scope changes.
- **No new dependencies.** SDK already supports `source.baseBranch`.
- **`dist/index.js` must be rebuilt** after all source changes.
