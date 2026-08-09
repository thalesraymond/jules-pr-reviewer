# Spec: Large-PR Handling

## Problem Statement

Prompt mode truncates the diff at 80,000 chars with a one-line caveat that the review "may be incomplete". On large PRs the tail of the diff — often most of it — is silently invisible to Jules, there is no notion of which files were reviewed, and the summary never states coverage. CodeRabbit caps files/review and reports skipped files; we currently hide the gap. Agentic mode has no size ceiling (Jules runs `git diff` itself) but its only large-PR signal is a hard-coded `fileCount > 50` nudge with no coverage requirement.

## Solution

Introduce a large-PR strategy driven by a size threshold and a strategy knob:

- **New inputs**: `large_pr_threshold` (characters, default `80000`) and `large_pr_strategy` (`prioritize` default | `truncate`).
- **Coverage-priority selection (default)**: when the filtered diff exceeds the threshold, split it into per-file sections, sort by churn (size, descending), and greedily pack sections into the threshold-sized prompt budget. Files that don't fit are explicitly listed as NOT reviewed; the prompt instructs Jules to state coverage in its summary, and the posted comment appends a deterministic coverage line.
- **Legacy `truncate` strategy**: keeps the old char-level cut and its caveat note, but now also reports file-level coverage instead of silently hiding the cut.
- **Both diff modes**: prompt mode selects a prioritized subset of the diff; agentic mode cannot subset the diff (Jules fetches it itself), so it receives a trusted instruction to prioritize high-impact files and state coverage as "Reviewed X of N changed files".

## User Stories

1. As a maintainer, I want large PRs reviewed in a coverage-priority fashion instead of silently truncated at 80 KB, so that the highest-churn files are always reviewed.
2. As a maintainer, I want the review summary to always state how many of the changed files were reviewed on a large PR, so that the gap is explicit.
3. As a maintainer, I want the not-reviewed files listed, so that I know exactly what was skipped.
4. As a maintainer, I want `large_pr_threshold` to tune when the strategy kicks in, so that I can adapt to my repo's typical diff size.
5. As a maintainer, I want `large_pr_strategy: truncate` to preserve the legacy behaviour, so that existing users can opt back in.
6. As a maintainer, I want agentic mode to also require coverage reporting on large PRs, so that the guarantee holds in both modes.
7. As a maintainer, I want the deterministic coverage line computed by the action (not just requested from the LLM), so that coverage is reported even if Jules omits it from its summary.

## Implementation Decisions

### Coverage-priority selection, not chunked multi-session review

The ticket allows either. Chunked review would run several Jules sessions per PR and merge results — a much larger orchestration change that burns session budget and is hard to test without a live SDK. Coverage-priority selection is deterministic, unit-testable without Jules, and satisfies the acceptance criteria (explicit not-reviewed reporting + coverage in summary). Chunking is recorded as future work.

### Priority = churn (diff size, descending), greedy pack

Sorting by section size descending and greedily filling the budget maximizes the churn actually reviewed — the biggest, riskiest changes first. `excludedFiles` is re-presented in original diff order for stable, readable output. If a single file alone exceeds the budget, its first `budget` characters are included and it is marked "partially reviewed" so the biggest change still gets some coverage rather than being dropped.

### Threshold doubles as the packing budget

`large_pr_threshold` is both the "is this large?" gate and the prompt-size budget for selection. One knob keeps the config surface small and matches the default 80,000 that previously bounded the prompt.

### Deterministic coverage note appended by the action

Instructing Jules to state coverage is necessary but not sufficient — an LLM can omit it. The action computes the reviewed/excluded sets itself (prompt mode) and appends a coverage line to the posted comment, guaranteeing the acceptance criterion regardless of LLM compliance. In agentic mode the reviewed set is not known deterministically, so only the prompt instruction applies.

### Trusted instruction vs untrusted data split

The coverage instruction and reviewed/total counts are our own (trusted). The excluded file paths come from the PR's changed files, which are attacker-controlled, so they are rendered in the UNTRUSTED diff section as data with no embedded instructions. This preserves the prompt-injection defence (ADR-003).

### Agentic mode loses the `fileCount > 50` nudge

The hard-coded nudge is replaced by the configurable threshold-driven note, which carries the coverage requirement. The prompt builder's `fileCount` argument is removed from `AgenticDiffModeArgs`; the agentic call still receives the changed-file list separately for post-hoc verification.

## Testing Decisions

- **What makes a good test:** Test the selection math with a synthetic >80 KB diff fixture, the config parsing/defaults, the prompt rendering for both modes, and the index wiring (selection forwarded into the prompt, coverage line appended, no coverage when small). No Jules session involved.
- **Modules under test:**
  - `coverage.ts` — `splitDiffSections` (file boundaries), `preparePromptDiff` (truncate vs prioritize, oversized file, no-section fallback, small-diff no-op), `buildPostedCoverageNote`.
  - `config.ts` — `large_pr_threshold` and `large_pr_strategy` defaults, parsing, invalid strategy fails, threshold clamping.
  - `prompt.ts` — large-PR coverage section rendered for prompt and agentic modes, excluded-file list rendered untrusted, absent when small.
  - `index.ts` — prioritized diff forwarded on a large PR, coverage note appended to the posted body, coverage in the structured completion log, agentic coverage passed on large PRs.
- **Prior art:** existing `index.test.ts` "truncates large diffs" uses an 81 KB fixture; the new coverage fixture should use a real multi-file `diff --git` layout so section parsing is exercised.

## Out of Scope

- Chunked multi-session review and result merging (future work).
- File-count-based capping (CodeRabbit caps files/review; we pack by size into a char budget).
- `.gitignore`-aware automatic skips beyond the existing `ignored_paths` input.
- Post-hoc coverage reconciliation for agentic mode from Jules's reported `changedFiles` (the mismatch check stays informational).

## Further Notes

- Security model unchanged: PR title, description, diff, and rules remain UNTRUSTED; the excluded-file list is data rendered inside the UNTRUSTED diff section.
- See ADR-015 for the architectural decision record.
- Prompt mode remains the default (`diff_mode: prompt`); the new default strategy `prioritize` changes large-PR behaviour from silent truncation to explicit coverage.
