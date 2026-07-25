## Why

Jules currently posts inline review comments with text feedback and agent prompts, but developers must manually translate each suggestion into a code edit. GitHub natively supports `suggestion` blocks that allow reviewers to propose exact code replacements — applying them takes a single click. We are not using this capability, leaving friction on the table for every PR reviewed.

## What Changes

- Add an opt-in `enable_suggestions` action input (default `false`) so teams can adopt the feature when ready.
- Extend the `ReviewComment` type with two optional fields: `suggestion` (the exact replacement code) and `startLine` (for multi-line replacements).
- Update the Jules prompt to instruct the model to emit `suggestion` only when it can directly quote a precise, drop-in code replacement grounded in the visible diff. Suggestions are only emitted for `High` or `Medium` confidence comments.
- Extend the prompt's security section to guard against prompt-injection via malicious suggestion content (e.g., attacker-controlled code in the diff instructing Jules to produce a harmful suggestion).
- Format suggestion comments in GitHub with a ` ```suggestion ``` ` block and a **"Jules suggested this fix — review before applying"** attribution note above it.
- Implement a 3-tier graceful degradation ladder in `submitReview()`:
  1. Full comments with suggestions.
  2. Strip suggestions, retry inline comments.
  3. Summary-only review (existing fallback).
- Add pre-submission validation: guard `startLine <= line` and escape triple-backticks inside suggestion text to prevent malformed markdown.

## Capabilities

### New Capabilities

- `suggested-changes`: Opt-in capability for Jules to include GitHub-native one-click code suggestions alongside review comments, with graceful fallback and prompt-injection defenses.

### Modified Capabilities

- None. No existing spec-level behavior changes; existing review submission flow is extended, not replaced.

## Impact

**Source files:**
- `action.yml` — new `enable_suggestions` input
- `src/types.ts` — `ReviewComment` extended with `suggestion?` and `startLine?`
- `src/prompt.ts` — new JSON schema field instructions + security guardrail for suggestions
- `src/github.ts` — suggestion formatting + 3-tier submission ladder in `submitReview()`
- `src/index.ts` — read and forward `enable_suggestions` input; conditionally strip suggestions from comments before passing to `submitReview()`

**Test files:**
- `tests/prompt.test.ts` — new cases for suggestion prompt instructions
- `tests/github.test.ts` — new cases for suggestion formatting, fallback tiers, validation guards
- `tests/index.test.ts` — new cases for `enable_suggestions` input flag propagation

**Security:** The `suggestion` field content originates from LLM output conditioned on attacker-controllable diff data. Prompt guardrails must explicitly prevent the model from following instructions embedded in the diff to craft harmful suggestions. Pre-submission validation limits the blast radius of any malformed output.

**No new runtime dependencies required.**
