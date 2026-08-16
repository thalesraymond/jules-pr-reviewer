# ADR-019: Strictness profiles (quiet / chill / assertive)

## Status
Accepted

## Date
2026-08-16

## Context
Findings carry severity and confidence, but there is no global dial for how aggressively Jules hunts nits or which findings surface on the PR. CodeRabbit ships review profiles (`quiet`/`chill`/`assertive`) controlling nitpick level; Copilot has effort levels. Repos with very different review cultures need very different review noise levels from the same action.

## Decision
Add a single `strictness` input (`quiet` | `chill` | `assertive`, default `chill`) that steers both the prompt and the report threshold:

1. **Prompt steering via trusted per-level blocks** (`src/prompt.ts`): quiet and assertive each render an action-authored block titled `# Trusted: Strictness profile (<level>)` between the severity-tag and confidence-score sections. These are trusted instructions (like `extra_instructions` and the open-threads context), NOT untrusted data, so they take precedence over anything in the diff/PR/rules and preserve ADR-003. `chill` renders no block, making the default output byte-identical to today's prompt.
2. **Report threshold** (`src/strictness.ts`): a threshold map (`MIN_SURFACING_SEVERITY`) maps level → minimum severity — `quiet` → High, `chill` → Info (everything, exactly today's behavior), `assertive` → Info. `filterCommentsByStrictness` delegates to `filterCommentsBySeverity` with that minimum. `assertive` changes the hunt, not the threshold: the extra signal is Jules reporting more findings.
3. **The surfaced set drives everything that surfaces**: the filter runs once after parsing; submitted inline comments, check-run annotations, issue-count outputs, and structured logs all derive from the surfaced set. The LLM verdict is NOT recomputed from the surfaced set — the check-run conclusion keeps following Jules's verdict via `fail_on`; strictness controls noise on the PR page, not the verdict. The summary comment always posts. **Exception — `block_on`:** when `block_on` is set the conclusion is computed from the surfaced (post-filter) findings — the same "reported findings" contract as `min_severity_to_report` (ADR-017) — so in that mode the filters do shape the gate: a `warning` gate under `quiet` can only trip on High findings.
4. **"Confident-only" is a prompt instruction, not a filter rule**: quiet instructs Jules to report only findings it is confident about. The deterministic filter is severity-only because a confidence filter could silently drop a Medium-confidence High-severity bug — the worst kind of false negative. The prompt expresses doubt; the filter enforces severity.
5. **Config** (`src/config.ts`): `strictness` follows the existing `VALID_*`-array validation pattern (like `diff_mode`); invalid values fail config with a one-of error listing the levels.

## Alternatives Considered

### Two separate inputs (prompt aggressiveness + report threshold)
- Pros: Finer-grained control
- Cons: Two knobs to reason about; most users want one dial per the ticket's framing ("a single `strictness` input")
- Rejected: One input steering both, with the mapping table in the README

### Confidence filter in quiet mode (High severity AND High confidence)
- Pros: Literal reading of "confident-only"
- Cons: Drops High-severity bugs Jules tagged Medium confidence; the action would hide its own most important findings based on an LLM's self-reported confidence
- Rejected: Confidence discipline is prompt-level only; the deterministic filter is severity-based

### Recompute verdict from the surfaced set
- Pros: `fail_on: any` would not fail on suppressed warnings
- Cons: The verdict is the LLM's judgment of the PR; rewriting it from a subset changes merge semantics (a `block` verdict with all-High findings still fails), and `quiet` users typically still want the full verdict in the summary
- Rejected: Keep the verdict; strictness shapes noise, not the gate — with the documented `block_on` exception (conclusion from reported findings, ADR-017 contract)

### Four+ levels (add e.g. `silent`)
- Pros: More nuance
- Cons: Three levels match CodeRabbit and keep the table simple; `silent` (no comments at all) is close to just not running the action
- Rejected: Three levels

## Consequences
- Default (`chill`) prompts are byte-identical to today; existing prompt tests remain valid unchanged, and existing users see no behaviour change.
- `quiet` users get High-only reviews; the prompt asks for confident-only findings, the filter guarantees the severity ceiling.
- `assertive` users get aggressive hunting with all severities surfaced.
- The verdict/check-run gate is unchanged at every level; `issues_count`/`high_issues_count`/`warning_issues_count`/`info_issues_count` outputs count surfaced findings.
- The prompt builder gains an optional `strictness` argument (default `chill`); `Config` gains a required `strictness` field.
- Strictness blocks are trusted action text; the UNTRUSTED/untrusted split of ADR-003 is preserved.
