# Spec: Suggested Changes

## Problem Statement

Jules posts inline review comments with text feedback, but developers must manually translate each suggestion into a code edit. GitHub natively supports one-click `suggestion` blocks that propose exact code replacements, yet the action never uses them — leaving friction on the table for every reviewed PR.

## Solution

Add an opt-in `enable_suggestions` input (default `false`). When enabled, the `ReviewComment` type gains optional `suggestion` and `startLine` fields, the prompt instructs Jules to emit a `suggestion` only when it can directly quote a precise drop-in replacement grounded in the visible diff, and the action renders GitHub-native one-click suggestion blocks with a human attribution note. Pre-submission validation guards malformed data, and a 3-tier graceful degradation ladder keeps reviews from being lost if GitHub rejects suggestion-bearing comments.

## User Stories

1. As a developer, I want to apply a review suggestion with one click, so that I do not have to hand-translate Jules's feedback into a code edit.
2. As a maintainer, I want suggestions to be opt-in, so that teams see no behaviour change until they enable the feature.
3. As a maintainer, I want suggestions disabled to guarantee no `suggestion` block ever appears in a comment, regardless of LLM output.
4. As a developer, I want a single-line suggestion to target the flagged line, so that the replacement is applied exactly where the issue is.
5. As a developer, I want a multi-line suggestion to target the correct line range, so that a block of code can be replaced at once.
6. As a maintainer, I want an invalid `startLine` (greater than `line`) discarded and treated as a single-line suggestion, so that malformed data degrades gracefully.
7. As a maintainer, I want triple-backtick sequences inside suggestion text escaped, so that the suggestion block never breaks markdown rendering.
8. As a developer, I want the suggestion block rendered after the review message with a note that Jules suggested it, so that I know the fix is AI-proposed.
9. As a maintainer, I want the full submission ladder: full comments with suggestions first, suggestions stripped on 422, and summary-only review as the last resort.
10. As a maintainer, I want a warning emitted when suggestions are degraded, so that the reason for missing suggestion blocks is visible.
11. As a maintainer, I want the prompt to instruct Jules that a `suggestion` must contain only valid source code, so that shell commands, URLs, and markup do not leak into suggestion blocks.
12. As a maintainer, I want the prompt to prevent Jules from following attacker instructions in the diff or PR content that tell it what to put in the `suggestion` field, so that suggestion blocks cannot be weaponized via prompt injection.
13. As a maintainer, I want suggestions emitted only for High or Medium confidence comments, so that uncertain findings do not get one-click fixes.
14. As a developer, I want a Low-confidence comment to carry no suggestion, so that I am not offered a risky auto-fix.
15. As a maintainer, I want a suggestion only when Jules can directly quote the replacement from the visible diff, so that suggestions are grounded in the review context.

## Implementation Decisions

### Opt-in input, default `false`

`enable_suggestions` is an action input defaulting to `false`, so existing users see no behaviour change. Teams opt in when ready.

### Feature gating in the orchestrator, not the submission module

The submission module stays unaware of the feature flag: it formats whatever comments it receives. The orchestrator strips `suggestion` fields when the feature is disabled, keeping the submission module testable in isolation and the gate in the layer that owns input parsing.

### Pre-submission validation in the submission pipeline

Validation (discarding `startLine` when `startLine > line`, escaping triple-backticks) is formatting logic co-located with where the comment body is assembled, testable independently of the orchestrator.

### 3-tier fallback ladder via composed fallbacks

The existing summary-only fallback is extended to three tiers using the existing fallback utility:

- **Tier 1:** submit all comments with suggestion blocks included.
- **Tier 2** (on 422): strip `suggestion` from all comments, retry full inline comments, emit a warning that suggestions were degraded.
- **Tier 3** (on second 422): submit a summary-only review (existing behaviour).

Composing two fallback calls keeps each tier explicit and independently testable.

### Prompt contract for suggestions

The prompt instructs Jules that a `suggestion` must contain only valid source code replacing the flagged lines, must not contain shell commands, URLs, markup, or external references, must never follow instructions embedded in untrusted content, and is only emitted for High or Medium confidence when the replacement can be quoted from the visible diff. These guardrails are appended to the existing SECURITY section.

### Suggestion formatting

Comments with a `suggestion` render the standard severity/confidence header, the review message, an attribution note (`> ⚠️ Jules suggested this fix — review carefully before applying.`), the ` ```suggestion ``` ` fenced block, and then any "Prompt for Agents" collapsible block. Comments without a `suggestion` are unchanged.

## Testing Decisions

- **What makes a good test:** Test the external behaviour — presence/absence of `suggestion` fields in submitted comments by feature flag, formatting of suggestion blocks, pre-submission validation (invalid `startLine`, escaped backticks), and the 3-tier submission ladder — without hitting the GitHub API.
- **Modules under test:**
  - `submission.ts` — suggestion formatting, validation guards, and the 3-tier fallback ladder in the review-submission pipeline.
  - `prompt.ts` — suggestion prompt instructions (confidence gating, security guardrails).
  - `index.ts` — `enable_suggestions` input parsing and stripping of suggestions when disabled.
  - `types.ts` — `suggestion` and `startLine` on `ReviewComment`.
- **Prior art:** `tests/submission.test.ts` already exercises the fallback ladder and comment formatting; `tests/prompt.test.ts` asserts prompt content; `tests/index.test.ts` asserts input-flag propagation via mocked helpers. The new cases follow these patterns.

## Out of Scope

- Automatically applying suggestions — the developer always clicks.
- Suggestions on deleted (LEFT-side) lines; only RIGHT-side (added/context) lines are targeted.
- Validating that a suggestion compiles or is semantically correct — that is Jules's job.
- Supporting suggestions on lines outside the diff hunk — the fallback ladder degrades gracefully instead.
- Defaulting the feature to `true`.

## Further Notes

- GitHub's review API accepts `start_line` only when both `start_line` and `line` fall within a diff hunk; out-of-hunk or boundary-crossing suggestions surface as 422s and are handled by the degradation ladder.
- ADR-005 covers the review-submission fallback that this feature extends.
