# Implementation Tasks

## 1. Types & Input Schema

- [x] 1.1 Add `DiffMode` type (`"prompt" | "agentic"`) to `src/types.ts`
- [x] 1.2 Add `changedFiles?: string[]` to `ReviewResult` in `src/types.ts`
- [x] 1.3 Add `AgenticPromptArgs` interface to `src/types.ts` (repoFullName, prNumber, prTitle, prBody, baseSha, headSha, ignoredPaths, extraInstructions, rulesFromFile, openThreads, fileCount)
- [x] 1.4 Add `diff_mode` input to `action.yml` (default `"prompt"`)
- [x] 1.5 Add `agentic_fallback` and `verification_mismatch` to `StructuredLogEvent` union in `src/types.ts`

## 2. Tests — Types & Validation

- [x] 2.1 Write tests in `tests/validation.test.ts` for `changedFiles` parsing (present array, absent, non-array ignored)
- [x] 2.2 Write tests in `tests/types.test.ts` (or existing test file) for `DiffMode` type exports

## 3. Validation — changedFiles

- [x] 3.1 Add `changedFiles` extraction in `strictValidateReviewResult` in `src/validation.ts`

## 4. Tests — Agentic Prompt

- [x] 4.1 Write tests in `tests/prompt.test.ts` for `buildAgenticPrompt`: SHA-based diff instruction present, branch-ref fallback instruction present, read-only prohibition in SECURITY section, ignored_paths rendered, large-PR nudge when >50 files, no nudge when ≤50 files, UNTRUSTED labels on all user-controllable sections

## 5. Agentic Prompt Builder

- [x] 5.1 Implement `buildAgenticPrompt` in `src/prompt.ts`

## 6. Tests — Agentic Review Pipeline

- [x] 6.1 Write tests in `tests/jules.test.ts` for `runAgenticReview`: successful agentic session, session-creation failure → fallback, timeout → fallback, changedFiles empty → fallback, changedFiles partial → fallback, changedFiles extra-only → proceed, archive called on success, archive failure does not throw, archive called on fallback

## 7. Agentic Review Pipeline

- [x] 7.1 Add `archiveSession` helper in `src/jules.ts` (best-effort try/catch + logStructured)
- [x] 7.2 Implement `runAgenticReview` in `src/jules.ts` (session creation, polling, parsing, changedFiles verification, fallback trigger, archive)

## 8. Tests — Orchestration Branching

- [x] 8.1 Write tests in `tests/index.test.ts` for mode branching: `diff_mode=prompt` runs existing pipeline, `diff_mode=agentic` runs agentic pipeline, invalid `diff_mode` fails, changedFiles verification logic in index

## 9. Orchestration — Mode Branching

- [x] 9.1 Add `diff_mode` input parsing in `src/index.ts`
- [x] 9.2 Add mode branching: prompt path (existing) vs agentic path (new)
- [x] 9.3 Add changedFiles verification logic (compare `reported` vs `actual` file sets)
- [x] 9.4 Add file-count nudge threshold (>50 files) in agentic prompt construction

## 10. Documentation

- [x] 10.1 Update `README.md` with new `diff_mode` input documentation

## 11. Verification

- [x] 11.1 Run `pnpm lint` — zero errors
- [x] 11.2 Run `pnpm format:check` — no formatting issues
- [x] 11.3 Run `pnpm build` — `dist/index.js` bundles without errors
- [x] 11.4 Run `pnpm test` — all tests pass
- [x] 11.5 Run `pnpm coverage` — 90% threshold met (lines, functions, branches, statements)
