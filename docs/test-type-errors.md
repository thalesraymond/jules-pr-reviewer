# Test type-error map

## Reproduce

```bash
pnpm typecheck
```

`pnpm test` and `pnpm coverage` run the same check before starting Vitest.
`tsconfig.test.json` inherits strict production compiler settings, expands
`rootDir` to the repository root, includes sources, tests, and `vitest.config.ts`,
and disables emission. Production build settings remain unchanged.

## Baseline

Enabling the check exposed **8 diagnostics across 5 test files**. These are
existing errors, not errors introduced by the configuration change. All eight
have now been fixed without relaxing strictness or adding type assertions. The
locations below refer to the original baseline before the fixes.

| Original location | Code | Cause | Applied correction |
| --- | --- | --- | --- |
| `tests/evaluator.test.ts:13` | TS2459 | `ReviewResult` is imported from `src/evaluator.ts`, which imports it but does not export it. | Import the type directly from `../src/types.js`. |
| `tests/filtering.test.ts:11` | TS2698 | The untyped `importOriginal()` result is `unknown`, so it cannot be spread. | Supplied `typeof import("minimatch")` as the `importOriginal` type argument and explicitly typed the mock's parameters. |
| `tests/filtering.test.ts:16` | TS18046 | The same `unknown` result cannot be used to access `minimatch`. | The typed `importOriginal` correction above addresses both diagnostics. |
| `tests/index.test.ts:1689` | TS18048 | `Array.find()` may return `undefined`; `expect(...).toBeDefined()` does not narrow the variable for TypeScript. | Replaced the expectation with Vitest's narrowing assertion `assert.isDefined(annotationCall)`. |
| `tests/prompt.test.ts:738` | TS2353 | The agentic prompt fixture supplies `fileCount`, which is not part of `AgenticDiffModeArgs`. | Remove the stale property from the fixture. |
| `tests/submission.test.ts:348` | TS2339 | A plain `Error` has no `status` property. | Construct a typed error with `Object.assign(new Error("Unprocessable Entity"), { status: 422 })`. |
| `tests/submission.test.ts:380` | TS2339 | The same untyped HTTP error fixture occurs in the fallback test. | Use the same typed error construction. |
| `tests/submission.test.ts:408` | TS2339 | The same untyped HTTP error fixture occurs in the approval fallback test. | Use the same typed error construction. |

## Limitations

Existing explicit `any` types and `as any` casts can conceal additional type
problems. The eight diagnostics are the compiler-visible baseline, not a complete
inventory of unsafe test code. Keep ESLint enabled alongside this check; do not
suppress diagnostics or relax strictness to make the gate pass.
