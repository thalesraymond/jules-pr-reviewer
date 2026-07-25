## 1. Type Definitions

- [x] 1.1 Write tests in `tests/github.test.ts` for the new `ReviewComment` fields (`suggestion?`, `startLine?`) — verify that comments without these fields behave exactly as before
- [x] 1.2 Extend `ReviewComment` interface in `src/types.ts` with `suggestion?: string` and `startLine?: number`

## 2. Prompt Security & Suggestion Instructions

- [x] 2.1 Write tests in `tests/prompt.test.ts` that assert the prompt output includes the new suggestion JSON schema documentation and the security guardrail text
- [x] 2.2 Extend `buildReviewPrompt()` in `src/prompt.ts`:
  - Add `suggestion` and `startLine` fields to the `newComments` JSON schema block in the output format section
  - Append a suggestion-specific guardrail under the existing `# SECURITY — READ FIRST` section, explicitly prohibiting following instructions from untrusted sections to craft suggestion content, and constraining `suggestion` to source code only
  - Constrain `suggestion` emission to `High` or `Medium` confidence comments only (in the instructions)

## 3. Pre-submission Validation & Comment Formatting

- [x] 3.1 Write tests in `tests/github.test.ts` for:
  - `startLine > line` → `startLine` discarded
  - Triple-backticks in `suggestion` → escaped to `'''`
  - Comment with `suggestion` → body contains attribution note and ` ```suggestion ``` ` block
  - Comment without `suggestion` → body unchanged from current behaviour
  - `start_line` field is passed to the GitHub API comment object when valid
- [x] 3.2 Add a `sanitizeSuggestion(comment: ReviewComment)` helper in `src/github.ts` (or a private helper used by `submitReview`) that:
  - Discards `startLine` when `startLine > line`
  - Replaces triple-backtick sequences in `suggestion` with `'''`
- [x] 3.3 Update `submitReview()` in `src/github.ts` to call the sanitization helper and include the suggestion block and attribution note in the comment body when `suggestion` is present; pass `start_line` to the API comment object when valid

## 4. 3-Tier Fallback Ladder

- [x] 4.1 Write tests in `tests/github.test.ts` for all three tiers:
  - Tier 1 success: review posted with suggestion blocks intact
  - Tier 1 → Tier 2: 422 on first attempt, retry strips suggestions, emits `core.warning`, posts inline comments without suggestions
  - Tier 2 → Tier 3: 422 on second attempt, falls back to summary-only (existing behaviour)
- [x] 4.2 Refactor `submitReview()` in `src/github.ts` to implement the nested `withFallback` 3-tier ladder (Tier 1 outer, Tier 2 inner, Tier 3 existing summary-only)

## 5. Action Input & Orchestration

- [x] 5.1 Write tests in `tests/index.test.ts` for:
  - `enable_suggestions: false` (default) → `suggestion` fields stripped from all comments before `submitReview()`
  - `enable_suggestions: true` → `suggestion` fields forwarded as-is
- [x] 5.2 Add `enable_suggestions` input to `action.yml` with `description`, `required: false`, `default: "false"`
- [x] 5.3 Read `enable_suggestions` boolean input in `src/index.ts` and strip `suggestion` and `startLine` from all `newComments` when the flag is `false` before calling `submitReview()`

## 6. Verification & Documentation

- [x] 6.1 Run `pnpm lint` — must pass with zero errors
- [x] 6.2 Run `pnpm format:check` — must report no formatting issues
- [x] 6.3 Run `pnpm coverage` — must meet 90% thresholds across all metrics
- [x] 6.4 Run `pnpm build` — ncc bundle must compile without errors; verify `dist/index.js` is updated
- [x] 6.5 Update `README.md` to document the new `enable_suggestions` input (description, default, usage example showing `enable_suggestions: true`)
