# ADR-020: Zero-config defaults (fail_on defaults to never)

## Status
Accepted

## Date
2026-08-16

## Context
Issue #126 (part of #112): required inputs are the two secrets, but every other knob should have a sane default so the minimal workflow (`secrets + uses:` with no other inputs) produces a good review on a vanilla repo. The audit must cover the newest features: strictness (#119), checks API (#113), dedupe (#114), large-PR handling (#115), per-path rules (#117), ignore filters (#118).

The audit (see `docs/specs/zero-config-defaults.md`) found exactly one punishing default: `fail_on: blocking`. With it, an uncalibrated first review — on a repo the action has never seen, with no rules — can turn the check run red. A red check does not block merge by itself (branch protection must require the `jules/review` check), but it is still punishment: a red X on every commit of the first PR, and a silent time bomb for repos that later adopt "require all checks" branch protection and inherit an uncalibrated gate.

Every other default passed the audit: the secrets are required by nature; `skip_drafts`/`skip_forks` protect quota and security; `strictness: chill` is the ADR-019 balance; `diff_mode: prompt` is deterministic and cheap; `rules_file`/`rules_directory` are load-if-exists (behavior-neutral on a vanilla repo); `dedupe` prevents comment spam; `timeout_minutes: 30` matches real review latency; `large_pr_*` preserve review quality on big diffs.

## Decision

### `fail_on` defaults to `never` (was `blocking`)

- The check run concludes `success` on every verdict unless the action itself fails (quota, auth, parse, timeout, crash — those still fail the check, unchanged).
- The verdict is NOT hidden: it appears in the posted review comment, in the `verdict` output, and in the check-run description ("Review complete (verdict: block)").
- Gating becomes explicit opt-in, two one-liners: `fail_on: blocking` in the workflow (or `block_on: high` for severity-based gating), plus requiring the `jules/review` check in branch protection.
- `action.yml` and `src/config.ts` (new `DEFAULT_FAIL_ON`) both change; an empty/unset `fail_on` now falls back to `never` instead of failing config validation (matching how `strictness`/`diff_mode` fall back).
- Existing users who set `fail_on` explicitly are unaffected. Users who relied on the default `blocking` for gating must add `fail_on: blocking` — a deliberate, loudly-documented break in service of the zero-config goal.

### Everything else stays

The full per-input audit with one-line rationales is in the spec. Key non-changes: `strictness: chill` (ADR-019), `skip_forks: true` (ADR-003), `diff_mode: prompt`, `timeout_minutes: 30`, `enable_suggestions: false`, `dedupe: true`, `skip_drafts: true`, `rules_file`/`rules_directory` load-if-exists paths.

### Default parity is enforced by a test

The runner injects `action.yml` `default:` values into `getInput`, so `action.yml` and `src/config.ts` must agree. A test parses the `default:` lines from `action.yml` and asserts they match the harness's default surface and the resulting `Config`, so drift fails CI in either direction.

## Alternatives Considered

### Keep `fail_on: blocking`
- Pros: No behavior change for users gating on the default; the check's red state matches a blocking verdict.
- Cons: First-run punishment — an uncalibrated reviewer can turn CI red on a repo that never opted in to gating; "require all checks" branch protection inherits the uncalibrated gate by accident. The action's own README already treated gating as an opt-in (branch protection), so the default red state was never the mechanism of gating anyway.
- Rejected: Gating must be opt-in; the first-run default must be advisory.

### Default `fail_on: never` but keep empty-string validation failing
- Pros: Strict input validation.
- Cons: Inconsistent with the other enum defaults (`strictness`, `diff_mode` fall back on empty) and punishes workflows that pass empty values.
- Rejected: Fall back to `never` on empty, like the other enums.

### Change the verdict semantics instead (block verdict → never fail)
- Pros: Keeps `fail_on: blocking` meaningful.
- Cons: Same effective outcome for gating users, but silently changes what `blocking` means — worse than changing the default, which is visible in `action.yml` and the README table.
- Rejected: Keep `fail_on` semantics; change only the default.

## Consequences
- First-run workflow is genuinely copy-paste and advisory: review posted, check green, nothing blocked.
- Gating is explicit: `fail_on: blocking` (or `block_on: <severity>`) + branch protection.
- Existing explicit configs are unaffected; reliance on the default `blocking` is the one (documented) break.
- `action.yml`, `src/config.ts`, tests, and README stay in parity under test. The parity test covers `action.yml` ↔ config-harness ↔ resulting `Config`; the README inputs table and `examples/` are manually maintained and are not part of that enforced surface.
