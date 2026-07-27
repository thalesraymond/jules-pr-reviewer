# ADR-008: Vitest with 90% coverage thresholds enforced at commit time

## Status
Accepted

## Date
2026-06-14

## Context
As a GitHub Action handling untrusted input and posting to production PRs, correctness is critical. We need fast, reliable tests with high confidence. Coverage thresholds must be enforced, not aspirational.

## Decision
Use Vitest 4 with `@vitest/coverage-v8` for:
- Fast execution (Vitest uses esbuild for transformation)
- Native TypeScript support (no separate ts-jest config)
- V8-based coverage (accurate, no instrumentation overhead)
- 90% thresholds on lines, functions, branches, and statements
- Coverage enforced at commit time via Husky pre-commit hook AND in CI
- Test files in `tests/` mirror source files in `src/`

## Alternatives Considered

### Jest
- Pros: Mature ecosystem, widely known
- Cons: Slower, requires more configuration for TypeScript/ESM, ts-jest adds complexity
- Rejected: Vitest provides faster execution and native ESM/TypeScript support with less configuration

### Mocha + nyc
- Pros: Flexible, modular
- Cons: More setup, less integrated, slower
- Rejected: Requires significant configuration for TypeScript and ESM; slower than Vitest

### Lower thresholds (80%)
- Pros: Easier to maintain, fewer tests required
- Cons: 80% provides less meaningful safety for security-sensitive code; the codebase is small enough to sustain high coverage
- Rejected: The codebase is small and security-sensitive; 90% is achievable and provides stronger guarantees

### Coverage only in CI
- Pros: Faster local development
- Cons: Catching coverage drops at commit time prevents broken CI runs
- Rejected: CI-only enforcement means broken builds ship before they're caught

## Consequences
- All new code must include tests
- `src/types.ts` is excluded from coverage (type-only file)
- The `dist/` directory and test files are excluded
- Tests use `vi.fn()` and `vi.spyOn()` for mocking
- Coverage drops block commits via the pre-commit hook
