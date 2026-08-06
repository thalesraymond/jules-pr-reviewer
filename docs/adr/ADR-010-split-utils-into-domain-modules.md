# ADR-010: Split utils.ts into focused domain modules

## Status
Accepted

## Date
2026-08-06

## Context
`src/utils.ts` has grown into a grab-bag of 8 unrelated functions: `withRetry`, `withFallback`, `parseIgnoredPaths`, `shouldIgnorePath`, `filterDiff`, `extractJsonPayload`, `strictValidateReviewResult`, and `getErrorMessage`.

The module is shallow — its interface (8 exports) is nearly as complex as its implementation. Callers must know which of 8 functions to reach for, and the functions span three unrelated responsibilities: resilience (retry/fallback), validation (JSON extraction + review parsing), and filtering (path matching).

This violates the deep module principle: a lot of behaviour should sit behind a small interface. The current shape makes it hard to locate related logic, test cohesive units, and understand dependencies.

## Decision
Split `utils.ts` into four focused modules, each named after the domain concept it represents:

### 1. `src/resilience.ts`
Exports: `withRetry`, `withFallback`

Handles transient and permanent failures in external API calls. Both remain separate exports because they solve different problems — `withRetry` handles transient failures (same operation, exponential backoff), `withFallback` handles permanent failures (switch to alternative operation).

### 2. `src/validation.ts`
Exports: `parseReviewResponse`

Parses and validates LLM responses. Combines `extractJsonPayload` and `strictValidateReviewResult` into one function. Callers don't need to know about the two-step process (extract JSON from markdown, then validate structure). The extraction logic stays in the implementation, testable through internal seams if needed.

### 3. `src/filtering.ts`
Exports: `parseIgnoredPaths`, `filterDiff`

Narrows the diff scope based on ignored paths. Hides `shouldIgnorePath` as an implementation detail — it's only called from within `filterDiff`, so callers don't need to know about per-path matching logic.

### 4. `src/errors.ts`
Exports: `getErrorMessage`

Cross-cutting error message extraction. Used across index.ts, jules.ts, github.ts, and the new modules. A small, focused module with one function is still deep — the interface is tiny, the implementation handles all edge cases (Error objects, objects with message property, raw values).

## Alternatives Considered

### Keep utils.ts as-is
- Pros: No refactoring cost, no import changes
- Cons: Module remains shallow, hard to locate related logic, tests hit 8 unrelated functions
- Rejected: The grab-bag shape violates deep module principles and hurts locality

### Merge into fewer modules (e.g., one "helpers" module)
- Pros: Fewer files, simpler import structure
- Cons: Still a grab-bag, just renamed. Doesn't improve locality or leverage
- Rejected: Renaming doesn't deepen the module

### Inline small functions at call sites
- Pros: Eliminates the module entirely
- Cons: `getErrorMessage` is used in 4 files — inlining would scatter the logic. `withRetry` and `withFallback` are used in multiple places — inlining would duplicate the retry/backoff logic
- Rejected: Violates DRY, hurts locality for bug fixes

### Name modules after implementation (e.g., `retry.ts`, `json-parser.ts`)
- Pros: Explicit about what's inside
- Cons: Names break when implementation changes (e.g., you might swap retry strategies). Doesn't match domain vocabulary
- Rejected: Domain-concept names (resilience, validation, filtering) survive implementation changes

### Export all 8 functions from their new modules
- Pros: No call-site changes needed
- Cons: Doesn't deepen the modules — interfaces remain wide. `shouldIgnorePath` is only used internally, so exposing it adds no leverage
- Rejected: Hide implementation details (`shouldIgnorePath`, `extractJsonPayload`, `strictValidateReviewResult`) to deepen the interface

## Consequences
- **Positive:** Locality — retry bugs concentrate in `resilience.ts`, validation bugs in `validation.ts`, filtering bugs in `filtering.ts`
- **Positive:** Leverage — each module has a narrow interface (1-2 exports) hiding cohesive implementation
- **Positive:** Testability — tests hit one interface per responsibility, not 8 unrelated functions
- **Positive:** AI-navigability — domain-concept names make it obvious where to look
- **Negative:** More files to import from (4 instead of 1)
- **Negative:** Call-site changes required in index.ts, jules.ts, github.ts
- **Negative:** `parseReviewResponse` changes the validation interface — callers must adapt
- **Implementation:** Create 4 new files, update imports in index.ts/jules.ts/github.ts, delete utils.ts
- **Testing:** Existing tests in `tests/utils.test.ts` split into `tests/resilience.test.ts`, `tests/validation.test.ts`, `tests/filtering.test.ts`, `tests/errors.test.ts`. Coverage thresholds remain at 90%.
- **Documentation:** CONTEXT.md updated with domain module definitions. This ADR recorded in `docs/adr/`.
