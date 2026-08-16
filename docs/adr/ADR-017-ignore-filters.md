# ADR-017: Ignore filters and per-severity actions

## Status
Accepted

## Date
2026-08-16

## Context
Skip logic was limited to drafts, forks, and a single `bypass_label`; `fail_on` was all-or-nothing per verdict (a repo that wants to "block only on High, ignore Info" could not express that). CodeRabbit supports title-keyword ignores, username ignores, label allow/deny filters, and per-check enforcement modes. Labels cannot be relied on in `pull_request` event payloads (title-keyword and author ignores are free of that ordering problem).

## Decision
Add five inputs, all defaulting to the exact current behaviour:

1. **`ignore_title_keywords`** — JSON array or comma/newline-separated list of case-insensitive substrings; any hit in the PR title skips the review. Parsed with a generic `parseListInput` extracted from `parseIgnoredPaths` so every list input shares one parsing contract.
2. **`ignore_authors`** — same parsing; a case-insensitive match against `pull_request.user.login` skips the review.
3. **`review_labels`** — one input with CodeRabbit-style semantics: plain entries are allow labels (PR must have at least one), `-`-prefixed entries are deny labels (PR must have none); mixed policies combine as "≥1 allow and 0 deny". Evaluability is defined as payload presence: a labels array in the payload (even empty) is enforced; a missing labels field means the filter cannot be applied — warn and continue, never fail or silently skip.
4. **`min_severity_to_report`** — findings below the threshold (`info` default | `warning` | `high`) are dropped at the reporting boundary: not posted, not annotated, not counted. The LLM summary prose is left untouched.
5. **`block_on`** — when set (`high` | `warning` | `info`), the check conclusion is computed deterministically from *reported* findings (failure iff a finding is at or above the severity) instead of the verdict-based `fail_on` mapping, which stays active when `block_on` is unset.

The three skip filters run before the Octokit client is constructed, so skipped PRs never create a check run or Jules session. Skip/report decisions live in pure modules (`src/ignore.ts`, `src/severity.ts`) that are unit-testable without a Jules session; `index.ts` only orchestrates.

## Alternatives Considered

### Label filters via the GitHub API
- Pros: Always current labels, no payload limitation
- Cons: Extra API call per run, needs an event model for `labeled` actions to be correct, larger change surface
- Rejected: Payload-only evaluation with a warn-and-continue fallback satisfies the acceptance criteria ("only act when evaluable") with zero extra API surface

### Severity gating as a single overloaded knob
- Pros: One fewer input
- Cons: Mixing "what to post" with "what to fail on" forces awkward semantics (e.g. "report everything but block only on High")
- Accepted: Two orthogonal inputs — reporting (`min_severity_to_report`) and blocking (`block_on`) — each with an existing-style default that preserves current behaviour

### Overriding the LLM verdict when filtering findings
- Pros: Outputs stay internally consistent
- Cons: Discards LLM judgment; the verdict output is part of the documented contract
- Rejected: Only the check conclusion can be severity-driven; `verdict` remains the LLM's verdict

## Consequences
- Existing configurations are unchanged: all new inputs default to previous behaviour.
- Skipped PRs (title/author/label) produce `verdict: skipped` outputs and never touch GitHub's check-run or Jules APIs.
- Label filters can never break the pipeline: un-evaluable payloads warn and review.
- `block_on` and `fail_on` both exist; `block_on` takes precedence for the conclusion when set (documented), since findings and verdict can disagree — that disagreement is the feature.
- Findings filtered by `min_severity_to_report` are excluded from comments, annotations, counts, and structured logs, but not from the LLM-written summary prose.
