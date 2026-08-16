# Spec: Strictness Profiles

## Problem Statement

Every finding already carries severity and confidence, but there is no global dial for how aggressively Jules hunts nits and which findings surface on the PR. A repo with strict, security-sensitive review culture wants every warning and style nit surfaced; a repo where reviewers are stretched wants only high-confidence, high-severity findings. CodeRabbit ships review profiles (`quiet`/`chill`/`assertive`) controlling nitpick level; Copilot has effort levels. We have neither the prompt-level control nor a report threshold.

## Solution

Introduce a single `strictness` input with three levels that steer both the prompt (how aggressively Jules hunts) and the report threshold (which severities surface on the PR):

- **`quiet`** — report only High-severity findings; the prompt instructs Jules to hunt conservatively and to surface only findings it is confident about. Infos and style nits are suppressed.
- **`chill`** (default) — today's behavior, byte-for-byte. No strictness block is added to the prompt and every finding posts.
- **`assertive`** — hunt style/correctness aggressively; the prompt instructs Jules to report low-confidence suspicions, style nits, naming, duplication, and dead code. All severities surface (same threshold as `chill`; the extra signal comes from the hunt).

## User Stories

1. As a maintainer of a security-sensitive repo, I want a `quiet` review that only surfaces High-severity findings, so that reviewers are not drowned in nits.
2. As a maintainer, I want `chill` to keep behaving exactly like today, so that existing users see no change when they upgrade.
3. As a maintainer of a repo that wants thorough style review, I want `assertive` to hunt style/correctness issues aggressively, so that nothing falls through the cracks.
4. As a maintainer, I want the strictness level to be a single input that adjusts both the prompt and the report threshold together, so that I don't have to reason about two knobs.

## Implementation Decisions

### Per-level trusted instruction block in the prompt

Each level maps to a small, action-authored instruction block rendered as `# Trusted: Strictness profile (quiet|assertive)` between the severity-tag and confidence-score sections. It is trusted (like `extra_instructions` and the open-threads context), NOT part of the UNTRUSTED data sections — it is our own text and takes precedence over anything in the diff/PR/rules. `chill` renders no block at all, which is what makes it byte-identical to today's prompt (the existing prompt tests stay green unchanged).

### Report threshold: quiet = High only; chill and assertive = everything

Today every finding posts. `chill` must match today's behavior exactly, so it surfaces everything. `assertive` changes only the hunt (prompt), not the threshold — the extra signal comes from Jules reporting more findings, all of which still surface. `quiet` suppresses Warning and Info findings at the action level (`filterCommentsByStrictness` in `src/strictness.ts`), so the threshold holds even if Jules ignores the prompt instruction.

### "Confident-only" lives in the prompt, not the filter

The acceptance criterion calls quiet "confident-only". The deterministic action-side filter is severity-only (High) because confidence-based filtering could silently drop a Medium-confidence High-severity bug — the worst kind of false negative. Confidence discipline is the prompt's job: quiet instructs Jules to report only findings it is confident about. This split is documented in the ADR.

### Filtering is applied to everything that surfaces

The filter runs once, right after the review is parsed, and the surfaced set feeds the submitted inline comments, the check-run annotations, the issue-count outputs, and the structured logs. The verdict (and therefore the check-run conclusion via `fail_on`) is NOT recomputed: it reflects Jules's judgment of the PR, while strictness controls noise on the PR page. The summary comment always posts. **Exception — `block_on`:** when `block_on` is set, the conclusion is computed from the surfaced (post-filter) findings — the same "reported findings" contract as `min_severity_to_report` (ADR-017) — so in that mode strictness does shape the gate: a `warning` gate under `quiet` can only trip on High findings.

## Testing Decisions

- **What makes a good test:** Pure-function tests of the threshold, prompt-rendering tests per level (including the chill == default identity), config parsing/default/validation, and index wiring (filtering before submission, counts/annotations from the surfaced set). No Jules session involved.
- **Modules under test:**
  - `strictness.ts` — `meetsReportThreshold` and `filterCommentsByStrictness` per level.
  - `prompt.ts` — quiet/assertive sections rendered (both diff modes), chill renders nothing, chill output identical to the strictness-less output.
  - `config.ts` — default `chill`, parsing each level, invalid value fails, empty string falls back.
  - `index.ts` — strictness forwarded to both prompt builders; quiet drops Warning/Info from submitted comments, annotations, counts, and logs; chill keeps today's flow (covered by existing tests).
- **Prior art:** existing `prompt.test.ts` and `config.test.ts` styles; the config module's `VALID_*`-array validation pattern from `diff_mode`/`large_pr_strategy`.

## Out of Scope

- Per-path or per-author strictness overrides.
- A confidence threshold input (confidence discipline stays prompt-level).
- Recomputing the verdict from the surfaced comment set.
- A fifth severity level.

## Further Notes

- Security model unchanged: the strictness blocks are trusted action text; all attacker-controlled data stays UNTRUSTED.
- See ADR-019 for the architectural decision record.
