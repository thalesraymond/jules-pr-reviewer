# ADR-012: Config module deepens the input gateway

## Status
Accepted

## Date
2026-08-07

## Context
`src/index.ts` opens with a shallow input gateway: ~35 lines of inline `core.getInput` / `core.getBooleanInput` reads for all 13 action inputs, ad-hoc validation for `fail_on` and `diff_mode`, a `parseInt` clamp for `timeout_minutes`, `as` casts that ADR-001 bans, and the secret envelope (`core.setSecret` plus the `process.env.JULES_API_KEY` / `process.env.GITHUB_TOKEN` writes that `src/logging.ts`'s `scrubSecrets` redacts against).

The interface is nearly as complex as the implementation — a pass-through with no depth. The cost shows up in the test suite: `tests/index.test.ts` re-implements the same input→value map in ~13 places because there is no parsing seam to cross, and the entry point cannot be reasoned about without reading its first 72 lines.

## Decision
Extract a **Config module** (`src/config.ts`) exposing one interface:

```
loadConfig(io: InputReader): ConfigResult   // never throws
InputReader = { getInput, getBooleanInput, setSecret }   // structural type
ConfigResult = { ok: true; config: Config } | { ok: false; error: string }
```

- `loadConfig` accepts an injected `InputReader` instead of importing `@actions/core`. `core` satisfies the structural type in production; tests inject a 6-line fake. Two adapters across the seam make it a real one.
- All failure modes collapse into `ConfigResult`: missing required secrets (the `required: true` read is wrapped), invalid `fail_on`/`diff_mode`, and non-boolean boolean inputs. `loadConfig` never throws.
- The secret envelope lives in the module: `setSecret` for both credentials and the `process.env` writes that `logging.ts`'s scrubber depends on.
- Real type guards replace the `as` casts (`fail_on` → `FailOn`, `diff_mode` → `DiffMode`; domain unions stay in `src/types.ts`).
- Optional text inputs (`rules_file`, `extra_instructions`, `ignored_paths`) normalize empty strings to `undefined`, so call sites drop their `|| undefined` checks.
- Defaults stay canonical in `action.yml`; the module re-applies matching fallbacks only for explicit empty strings. `ignored_paths` is exposed raw (`string | undefined`); parsing stays in the Filtering module (ADR-010's seam).
- `Config` mirrors the existing 13 local variable names (`apiKey`, `token`, `failOn`, `diffMode`, `skipDrafts`, `skipForks`, `bypassLabel`, `statusContext`, `extraInstructions`, `rulesFilePath`, `ignoredPaths`, `timeoutMinutes`, `enableSuggestions`).

`index.ts` replaces its input block with `loadConfig(core)` + an early `setFailed` return on `!ok`, and downstream call sites read from the typed `Config`.

## Alternatives Considered

### Pure `parseConfig(raw)` with reads left in index.ts
- Pros: No `@actions/core` dependency, trivial test inputs
- Cons: The reads remain a pass-through in the orchestrator — the shallow part survives; index.ts still owns the input channel
- Rejected: Leaves the exact friction this module exists to remove

### `loadConfig` imports `@actions/core` directly
- Pros: One less parameter, no structural type
- Cons: Tests must mock `@actions/core` and re-implement the read map; the seam is invisible
- Rejected: The injected `InputReader` is the test surface — the interface is the test surface

### Keep required-secret missing as a throw
- Pros: Matches today's behavior exactly
- Cons: Two failure modes (throw for required, result for invalid) — a wider interface, two ways to test
- Rejected: One failure mode is deeper than two

### Module calls `core.setFailed` itself
- Pros: No result type needed
- Cons: Splits the early-return decision across modules; the module can't be exercised without a side-effecting core
- Rejected: Validation messages belong in the module, the early return belongs in the orchestrator

### Config module owns the defaults, action.yml drops `default:` fields
- Pros: Single source of truth for default values
- Cons: `action.yml` is the user-facing contract (documented in README and surfaced by workflow tooling); stripping its defaults removes the documented values
- Rejected: `action.yml` stays canonical; the mirrored fallbacks only guard the explicit-empty-string edge

### Config parses `ignored_paths` into `string[]`
- Pros: Callers get a ready-to-use list
- Cons: Path matching is the Filtering module's concern (ADR-010); the agentic prompt also needs the raw string, so both forms would leak into `Config`
- Rejected: Config normalizes input; Filtering parses paths

## Consequences
- **Positive:** Locality — config bugs concentrate in `src/config.ts`; the defaults/validation/envelope are no longer scattered across the entry point
- **Positive:** Leverage — one typed `Config` for `index.ts` and every test; ~13 re-implemented input maps in `tests/index.test.ts` collapse into one canned mock
- **Positive:** Testability — the whole parsing/validation/envelope matrix is exercised through a 6-line fake, without touching `@actions/core`
- **Positive:** Type safety — `as` casts replaced by narrowing type guards (aligns with ADR-001)
- **Positive:** `loadConfig` never throws — one failure mode, testable without exception gymnastics
- **Negative:** New module and import in `index.ts`; call sites change from locals to `config.*`
- **Negative:** `config.ts` requires full coverage (tests must cover every input, default, and error path)
- **Negative:** The `process.env` → `logging.ts` redaction coupling is now inside the module; future loggers must not assume a different wiring
- **Implementation:** Create `src/config.ts`, replace the input block in `src/index.ts`, update call sites
- **Testing:** New `tests/config.test.ts` (fake `InputReader`); `tests/index.test.ts` mocks `src/config.js` with a canned `Config` and keeps one smoke test through real `loadConfig`
- **Documentation:** CONTEXT.md updated with the Config module entry. This ADR recorded in `docs/adr/`.
