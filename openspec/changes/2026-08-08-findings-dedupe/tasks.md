# Implementation Tasks

## 1. Tests — Prompt dedupe instruction

- [x] 1.1 Write tests in `tests/prompt.test.ts`: dedupe instruction present when `dedupe` true (and when omitted, i.e. default), dedupe instruction absent when `dedupe` false, open-thread list always rendered, no threads → no dedupe section
- [x] 1.2 Write tests in `tests/config.test.ts`: `dedupe` default true, `dedupe: false` parsed, invalid boolean fails
- [x] 1.3 Write tests in `tests/index.test.ts`: `dedupe` forwarded into prompt construction for prompt mode (dedupe on → instruction present; dedupe off → instruction absent)

## 2. Types & Input Schema

- [x] 2.1 Add `dedupe?: boolean` to `CommonPromptArgs` in `src/types.ts`
- [x] 2.2 Add `dedupe` boolean to `Config` in `src/config.ts`
- [x] 2.3 Add `dedupe` input to `action.yml` (default `"true"`)

## 3. Implementation

- [x] 3.1 Update `buildThreadsContext(openThreads, dedupe)` in `src/prompt.ts` with the trusted Deduplication instruction; default `dedupe` to `true` in `buildReviewPrompt`
- [x] 3.2 Parse `dedupe` in `loadConfig` via `getBooleanInput`
- [x] 3.3 Forward `dedupe: config.dedupe` into both `buildReviewPrompt` calls in `src/index.ts`

## 4. Documentation

- [x] 4.1 Update `README.md`: feature bullet, `dedupe` input row, Inner Workings note
- [x] 4.2 Add `docs/adr/ADR-014-findings-deduplication.md`
- [x] 4.3 Update `CONTEXT.md` OpenThread concept if needed

## 5. Verification

- [x] 5.1 Run `pnpm lint` — zero errors
- [x] 5.2 Run `pnpm format:check` — no formatting issues
- [x] 5.3 Run `pnpm build` — `dist/index.js` bundles without errors
- [x] 5.4 Run `pnpm test` — all tests pass
- [x] 5.5 Run `pnpm coverage` — 90% threshold met (lines, functions, branches, statements)
