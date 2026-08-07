# ADR-011: Split github.ts into data-fetching and submission modules

## Status
Accepted

## Date
2026-08-06

## Context
`src/github.ts` has grown into a grab-bag of 6 exports spanning two unrelated concerns: fetching data from GitHub (diffs, rules, threads, status) and formatting/submitting review comments. The comment formatting pipeline includes XSS sanitization, suggestion escaping, severity/confidence emoji rendering, prompt-for-agents collapsible blocks, and a 3-tier fallback ladder for submission resilience.

The module is shallow — its interface (6 exports) is nearly as complex as its implementation (349 lines). Callers must know which of 6 functions to reach for, and the functions span two unrelated responsibilities: data-fetching and review submission formatting.

This violates the deep module principle: a lot of behaviour should sit behind a small interface. The current shape makes it hard to locate related logic, test cohesive units, and understand dependencies.

## Decision
Split `github.ts` into two focused modules, each named after the domain concept it represents:

### 1. `src/github.ts` (data-fetching)
Exports: `fetchDiff`, `loadRulesFromBase`, `fetchOpenThreads`, `resolveThreads`, `setStatus`

Handles all GitHub API interactions for fetching data and managing review threads. The module narrows from 6 exports to 5, all focused on data-fetching and thread management.

### 2. `src/submission.ts` (review submission)
Exports: `submitReview`

Formats and submits review comments to GitHub. Hides the entire formatting pipeline as implementation details:
- `sanitizeSuggestion` — escapes triple backticks, validates startLine
- `formatCommentBody` — renders severity/confidence emojis, suggestion blocks, prompt-for-agents collapsible
- `buildApiComment` — constructs the API payload
- `isUnprocessableEntity` — error classification for fallback decisions
- The 3-tier fallback ladder (with suggestions → without suggestions → summary-only)

The module has one export hiding ~220 lines of implementation. This is a deep module: small interface, lots of behaviour.

## Alternatives Considered

### Keep github.ts as-is
- Pros: No refactoring cost, no import changes
- Cons: Module remains shallow, hard to locate formatting logic, tests hit 6 unrelated functions
- Rejected: The grab-bag shape violates deep module principles and hurts locality

### Bundle submitReview parameters into a single object
- Pros: Cleaner call site, fewer parameters
- Cons: Adds a type definition (ReviewSubmissionInput) with no leverage gain. The interface is already narrow (one export). Bundling params doesn't deepen the module.
- Rejected: Doesn't improve depth or testability. Adds complexity without benefit.

### Extract only the formatting helpers, keep submitReview in github.ts
- Pros: Smaller refactor, fewer file changes
- Cons: The fallback ladder (which is the real complexity) stays in github.ts. The seam is still split across two concerns.
- Rejected: Doesn't fully separate the concerns. The fallback logic is part of the submission responsibility.

### Name the module `review-submission.ts` or `comment-formatter.ts`
- Pros: More explicit about what's inside
- Cons: `review-submission.ts` is redundant (the project is already about reviews). `comment-formatter.ts` is too narrow (the module also handles the fallback ladder, not just formatting).
- Rejected: `submission.ts` is the shortest name that survives implementation changes and accurately describes the responsibility.

### Export all private helpers for testing
- Pros: Tests can verify individual formatting functions
- Cons: Doesn't deepen the module — interface remains wide. The helpers are implementation details; exposing them adds no leverage.
- Rejected: Hide implementation details to deepen the interface. Test through the public seam (submitReview).

## Consequences
- **Positive:** Locality — formatting bugs concentrate in `submission.ts`, data-fetching bugs in `github.ts`
- **Positive:** Leverage — submission module has a narrow interface (1 export) hiding cohesive implementation
- **Positive:** Testability — tests hit one interface per responsibility, not 6 unrelated functions
- **Positive:** AI-navigability — domain-concept names make it obvious where to look
- **Positive:** Deletion test passes — removing submission.ts would force the fallback ladder back to callers
- **Negative:** More files to import from (2 instead of 1 for GitHub-related operations)
- **Negative:** Call-site changes required in index.ts
- **Negative:** Tests split across two files instead of one
- **Implementation:** Create `src/submission.ts`, move `submitReview` and 4 private helpers, update imports in index.ts, split tests
- **Testing:** Existing tests in `tests/github.test.ts` split into `tests/github.test.ts` (data-fetching) and `tests/submission.test.ts` (submission). Coverage thresholds remain at 90%.
- **Documentation:** CONTEXT.md updated with submission module definition. AGENTS.md updated with new file structure. This ADR recorded in `docs/adr/`.
