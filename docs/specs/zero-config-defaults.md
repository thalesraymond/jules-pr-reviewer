# Spec: Zero-Config Defaults

## Problem Statement

The action requires two secrets (`jules_api_key`, `github_token`) — acceptable, since a Jules key is the whole point — but every other knob should have a sane default that produces a good review on a vanilla repo, so the minimal workflow is genuinely copy-paste. As features have accumulated (checks API, dedupe, large-PR handling, per-path rules, ignore filters, strictness), defaults were chosen per-feature without a holistic first-run audit. A first-time user must not be surprised or punished by a default.

## Solution

Audit every input against one question: *does the default produce a quality review on a vanilla repo, and would a first-time user be surprised or punished by it?* Change the defaults that fail the test; document why every other default exists. Keep the required secret pair as the only mandatory surface.

The full audit table (verdicts):

| Input | Default | Verdict | Rationale |
| ----- | ------- | ------- | --------- |
| `jules_api_key` | — (required) | keep | A Jules key is the point of the action; cannot be defaulted. |
| `github_token` | — (required) | keep | Standard `GITHUB_TOKEN`; no sensible default. |
| `fail_on` | `blocking` → **`never`** | **CHANGED** | An uncalibrated first review must not turn CI red. The verdict still surfaces in the comment, the outputs, and the check description; gating becomes explicit opt-in (`fail_on: blocking` or `block_on` + branch protection). See ADR-020. |
| `min_severity_to_report` | `info` | keep | First run should surface everything so the user sees the tool's full signal. |
| `block_on` | unset | keep | Unset = verdict-based mapping via `fail_on`. With `fail_on: never` default, the check never fails from findings until the user opts in — severity gating is one line away (`block_on: high`). |
| `strictness` | `chill` | keep | Balanced hunting, byte-identical prompt to pre-strictness releases (ADR-019). |
| `skip_drafts` | `true` | keep | Draft PRs are WIP; reviewing them burns a Jules session against the free quota and reviews code the author hasn't finished. `ready_for_review` triggers a review. |
| `skip_forks` | `true` | keep | Security default: an untrusted fork's diff/description can carry prompt-injection payloads (ADR-003). |
| `bypass_label` | `jules-override` | keep | Harmless escape hatch; only acts when the user applies the label. |
| `ignore_title_keywords` | `''` | keep | Off by default; PR-level skips are opt-in policy, not first-run concerns. |
| `ignore_authors` | `''` | keep | Off by default; same reasoning. |
| `review_labels` | `''` | keep | Off by default; only enforced when the payload carries labels, otherwise warn-and-continue. |
| `status_context` | `jules/review` | keep | Stable check-run name; configurable for coexistence with other tools. |
| `extra_instructions` | `''` | keep | Opt-in customization. |
| `rules_file` | `.github/jules-review-rules.md` | keep | Load-if-exists: vanilla repos have no such file, so no behavior change; the file is read from the base SHA (security). |
| `rules_directory` | `.github/jules-rules` | keep | Load-if-exists, per-path rules; vanilla repos see no behavior change. |
| `ignored_paths` | `[]` | keep | Nothing ignored by default — the full diff is reviewed. |
| `timeout_minutes` | `30` | keep | Real reviews often take 15–25 minutes; a lower default would miss legitimate reviews, a higher one would stall CI. |
| `enable_suggestions` | `false` | keep | Suggested changes depend on GitHub accepting the diff-range edits; the fallback ladder handles rejection, but the extra tokens/formatting are opt-in. |
| `dedupe` | `true` | keep | Prevents comment spam across pushes on the same PR — the first-run experience stays quiet. |
| `diff_mode` | `prompt` | keep | Prompt mode is deterministic, cheap, and works everywhere; agentic gives Jules full repo context and removes the diff-size ceiling but is slower and token-heavier — a power-user upgrade, not a first-run default. |
| `large_pr_threshold` | `80000` | keep | Above this, the `prioritize` strategy keeps review quality on big diffs instead of silently truncating. |
| `large_pr_strategy` | `prioritize` | keep | Reviews the highest-churn files that fit the budget and states coverage explicitly; legacy `truncate` silently drops tail files. |

One default changed: `fail_on` `blocking` → `never`. Every other default is either required (secrets), security/quality-motivated, or load-if-exists (behavior-neutral on a vanilla repo).

## User Stories

1. As a first-time user, I want to paste a two-line workflow (secrets + `uses`) and get a quality review on my first PR, so that setup is genuinely copy-paste.
2. As a first-time user, I want my CI to stay green while the AI reviewer finds its footing, so that an uncalibrated first review cannot punish my repo.
3. As a power user, I want to opt in to gating (fail the check on blocking verdicts) and to the heavier pipelines (agentic, suggestions), so that the first-run experience stays light.
4. As an existing user who set inputs explicitly, I want my configuration to behave exactly as before, so that default changes never alter an explicit config.
5. As a maintainer, I want the action.yml defaults and the runtime defaults to be provably in sync, so that drift bugs cannot be introduced silently.

## Implementation Decisions

### `fail_on` defaults to `never`

The check run is advisory on first run. The review comment, the `verdict` output, and the check-run description ("Review complete (verdict: block)") all still surface the verdict; only the conclusion stays `success`. Gating is three opt-ins away: `fail_on: blocking` (or `block_on: high`), plus requiring the `jules/review` check in branch protection. Decision record and alternatives: ADR-020.

### Parity between `action.yml` and `src/config.ts` is a test, not a habit

`action.yml` is metadata (the runner injects its `default:` values into `getInput`); `src/config.ts` is the runtime source of truth. A regression test parses the `default:` lines out of `action.yml` and asserts they match the test harness's default input set, and the default-inputs test asserts the resulting `Config`. Any drift — metadata changed without runtime, or runtime changed without metadata — fails a test.

### The rules inputs are "load-if-exists", not "load-always"

`rules_file` and `rules_directory` default to conventional paths that almost no vanilla repo has. At runtime the loader warns and returns nothing when the path is missing, so the default is behavior-neutral on a vanilla repo while still being zero-config for repos that adopt the convention.

### The required inputs stay required

The two secrets are the only mandatory surface. They cannot be defaulted (they are per-user credentials), and a Jules key is the point of the action (issue context).

## Testing Decisions

- **What makes a good test:** Pure config-level tests — default values from an empty input surface, and the action.yml ↔ config parity guard. No Jules session involved.
- **Modules under test:**
  - `config.ts` — `fail_on` defaults to `never` when unset/empty; explicit values still parse; invalid values still fail.
  - `action.yml` ↔ `config.ts` parity — parse the `default:` lines from `action.yml` and assert they match the documented default surface; assert the resulting full `Config` from that surface.
- **Prior art:** existing `tests/config.test.ts` styles and the `DEFAULT_INPUTS` harness.

## Out of Scope

- Live smoke run ("fresh empty config run on a test PR", 1 Jules session): needs a live Jules session and a real PR, which the implementation cannot run. **Maintainer follow-up:** open a test PR on a vanilla repo with the minimal workflow, confirm a review is posted, the check run concludes `success`, and the log shows no surprises.
- Auto-approve (#120) — future Phase 3 ticket; not part of this audit.
- Changing prompts, strictness levels, or any non-default behavior.
- Making `fail_on`/`block_on` richer (e.g. per-path gates).

## Further Notes

- Existing users who set `fail_on` explicitly are unaffected; users who relied on the *default* `blocking` now see a green check on `block` verdicts unless they set `fail_on: blocking` — a deliberate, documented break (ADR-020).
- The README Quickstart already was "secrets + uses"; it now documents what actually happens on a vanilla PR (advisory check, review posted, drafts/forks skipped, dedupe on).
- See ADR-020 for the decision record.
