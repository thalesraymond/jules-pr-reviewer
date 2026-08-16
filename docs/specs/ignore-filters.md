# Spec: Ignore Filters & Per-Severity Actions

## Problem Statement

Skip logic today is only: drafts, forks, and a single `bypass_label`. CodeRabbit supports title-keyword ignores, username ignores, label allow/deny filters (incl. negative entries), and per-check enforcement modes. We cannot run when a label isn't present on the *head* commit, but title-keyword and author ignores are free (no label ordering problem). Separately, `fail_on` is all-or-nothing per verdict: a repo that wants to "block only on High, ignore Info" cannot express that — Info findings still get posted, and any non-`approve` verdict fails the check when `fail_on: any` regardless of what actually surfaces.

## Solution

Add five new inputs:

- **`ignore_title_keywords`** — list (JSON array or comma/newline-separated, parsed with the same `parseListInput` helper as `ignored_paths`) of case-insensitive substrings. If the PR title contains any of them, the review is skipped with an info log line.
- **`ignore_authors`** — list of GitHub logins (same parsing). If the PR author's login matches (case-insensitive), the review is skipped.
- **`review_labels`** — allow/deny label policy. Plain entries are **allow** labels; entries prefixed with `-` are **deny** labels. The review runs only when the PR has at least one allow label (if any are configured) and none of the deny labels. The filter only acts when the event payload carries label data; when labels are missing from the payload, the action logs a warning and **continues** — it never fails on an un-evaluable filter.
- **`min_severity_to_report`** — findings below this severity (`info` default | `warning` | `high`) are dropped before posting: no inline comment, no check-run annotation, no issue count.
- **`block_on`** — severity-aware check conclusion (`high` | `warning` | `info`). When set, the check run fails iff at least one *reported* finding is at or above that severity, computed deterministically from the findings (not from the LLM verdict). When unset, the legacy `fail_on` verdict mapping is used unchanged.

Default behavior is exactly the current behavior: all inputs unset → no title/author/label skipping, `min_severity_to_report: info` keeps every finding, `block_on` unset → `fail_on` mapping.

## User Stories

1. As a maintainer, I want PRs whose titles match keywords like "WIP" or "dependabot" skipped automatically, so I don't burn Jules sessions on noise.
2. As a maintainer, I want PRs authored by bots or specific users skipped, so the action only reviews human work.
3. As a maintainer, I want to review only PRs carrying an allowed label (or never review PRs carrying a denied label), so the action integrates with my label-based triage workflow.
4. As a maintainer, I want label filters that never silently break the pipeline — when the event payload doesn't carry label data, the action warns and reviews anyway.
5. As a maintainer, I want Info/Warning noise filtered out of the posted review and counts, so only findings at or above my chosen severity reach the PR.
6. As a maintainer, I want the check run to fail only when a finding at or above a chosen severity is actually reported — "block only on High" — regardless of the LLM's coarse verdict.
7. As an existing user, I want every new knob off by default, so my current configuration behaves identically.

## Implementation Decisions

### Shared list parsing via a generic `parseListInput`

`ignored_paths` already accepts a JSON array *or* comma/newline-separated list. The three new list inputs reuse that exact contract by extracting the parsing into a shared `parseListInput` in `filtering.ts`; `parseIgnoredPaths` becomes a thin wrapper. One parsing contract across all list inputs keeps documentation and tests uniform.

### Title and author matches are cheap and deterministic

Both checks run from payload data alone (title string, `pull_request.user.login`) before the Octokit client is even constructed, alongside the existing draft/fork/bypass early returns. Title matching is case-insensitive **substring** (a keyword matches anywhere in the title — documented, since "wip" also matches "swipe"). Author matching is case-insensitive exact login (GitHub logins are case-insensitive for lookup).

### `review_labels`: one input, `-` prefix for deny, evaluability = payload presence

A single `review_labels` input with CodeRabbit-style `-` deny-prefix keeps the config surface small and supports pure allow, pure deny, and mixed policies in one knob:

| Config | PR labels | Result |
| ------ | --------- | ------ |
| `["security"]` | `[security]` | review |
| `["security"]` | `[]` / `[docs]` | skip |
| `["-wip"]` | `[wip]` | skip |
| `["security", "-wip"]` | `[security]` | review |
| `["security", "-wip"]` | `[security, wip]` | skip |
| any (labels missing from payload) | — | warn + review |

"Evaluable" is defined precisely: the `pull_request.labels` array **present** in the payload (even if empty) means the filter acts — an empty array is truthful "no labels" data, so an allow-list skips. A **missing** labels field means the payload carried no label data at all (a known `pull_request` webhook limitation — labels are not guaranteed in the payload), so the filter cannot be applied: warn and continue, never fail. Skipping on un-evaluable data could silently kill all reviews; an extra review is the cheaper, safer failure mode.

### Severity gating split into reporting and blocking, both off by default

Two orthogonal knobs rather than one overloaded one:

- **`min_severity_to_report`** (default `info`) — filters findings at the reporting boundary. Filtered findings are excluded from posted inline comments, check-run annotations, `issues_count`/`high|warning|info_issues_count` outputs, and the `review_completed`/`review_submitted` logs. The LLM-written summary text is left untouched (we cannot reliably strip severity claims from prose).
- **`block_on`** (default unset) — switches the check conclusion from the verdict-based `fail_on` mapping to a deterministic finding-based one: failure iff a *reported* finding sits at or above the threshold. This closes the loop on "ignore Info": with `min_severity_to_report: high` + `block_on: high`, Info/Warning findings never surface and a verdict of `comment` no longer fails the check.

Keeping `block_on` unset preserves the exact legacy behavior (`fail_on` mapping), satisfying the backward-compatibility requirement. When both `fail_on` and `block_on` are set, `block_on` wins for the conclusion — explicitly documented, since verdict and findings can disagree (the whole point is to let findings override the coarse verdict).

### Skip decisions live in a new `ignore` module; severity math in `severity`

`src/ignore.ts` owns the PR-level skip policy (`shouldIgnoreTitle`, `shouldIgnoreAuthor`, `evaluateLabelPolicy`) and `src/severity.ts` owns severity ordering/parsing (`parseSeverityGate`, `filterCommentsBySeverity`, `hasFindingsAtOrAbove`). Both are pure, unit-testable without a Jules session; `index.ts` only orchestrates.

## Testing Decisions

- **What makes a good test:** Pure-function tests for each filter (title substring case-insensitivity, author login matching, every `review_labels` table row above, severity ranking/filtering) plus index-level wiring tests: early-return skips (no `createCheckRun` call), warn-and-continue for missing labels, filtered comments absent from the submit payload and annotations, `block_on` overriding `fail_on`, and defaults preserving legacy behavior. No Jules session involved.
- **Modules under test:**
  - `ignore.ts` — `parseListInput` (via `filtering.ts`), `shouldIgnoreTitle`, `shouldIgnoreAuthor`, `evaluateLabelPolicy` (allow/deny/mixed/missing/empty).
  - `severity.ts` — `parseSeverityGate`, `filterCommentsBySeverity`, `hasFindingsAtOrAbove`, rank ordering.
  - `config.ts` — new inputs parse, defaults, invalid enum values fail with the accepted-values message.
  - `index.ts` — skip early-returns set `verdict: skipped` outputs and never create the check run; label not-evaluable logs a warning and still reviews; severity filtering reaches submit/annotations/counts/logs; `conclusionFromFindings` maps severities to conclusions; existing suites stay green unchanged.
- **Prior art:** `tests/filtering.test.ts` already covers the JSON-array/comma/newline parsing contract; `tests/index.test.ts` already covers the draft/fork/bypass early-return pattern.

## Out of Scope

- Refreshing labels via the GitHub API (a `labeled`-event listener or `GET /repos/{owner}/{repo}/pulls/{n}` fetch) — a bigger change; the payload-only rule keeps this feature free of extra API calls.
- Author-based auto-approve or "review once" semantics — only full skip is offered.
- Verdict recalculation from findings (the `verdict` output remains the LLM's verdict; only the check conclusion can be severity-driven via `block_on`).
- Editing the LLM summary prose to reflect filtered findings.

## Further Notes

- Security model unchanged: all new inputs are trusted config; they only remove review runs or findings, never add untrusted content to the prompt.
- See ADR-017 for the architectural decision record.
