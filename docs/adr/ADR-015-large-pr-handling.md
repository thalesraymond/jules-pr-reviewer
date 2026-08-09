# ADR-015: Large-PR handling with coverage-priority selection

## Status
Accepted

## Date
2026-08-09

## Context
Prompt mode truncates the diff at 80,000 chars with a caveat that the review may be incomplete; on large PRs the untruncated portion is invisible to Jules, no coverage is ever reported, and the summary cannot be trusted to reflect what was actually reviewed. Agentic mode has no size ceiling but only a hard-coded `fileCount > 50` nudge with no coverage requirement. CodeRabbit caps files/review and reports skipped files; we silently hid the gap.

## Decision
Introduce a large-PR strategy driven by `large_pr_threshold` (chars, default `80000`) and `large_pr_strategy` (`prioritize` default | `truncate`):

1. **Coverage-priority selection (default)**: when the filtered diff exceeds the threshold, split it into per-file sections, sort by churn (size, descending), and greedily pack sections into the threshold-sized budget. Files that don't fit are listed as NOT reviewed. If a single file exceeds the budget alone, its first `budget` chars are included and marked partially reviewed.
2. **`truncate` strategy (legacy opt-in)**: keeps the char-level cut and caveat note, but now also reports file-level coverage instead of silently hiding the cut.
3. **Deterministic coverage reporting**: the action computes the reviewed/excluded sets itself and appends a coverage line to the posted comment, so coverage is stated even if the LLM omits it. The prompt also instructs Jules to state coverage.
4. **Both diff modes**: prompt mode selects a subset of the diff; agentic mode (where Jules runs `git diff` itself) receives a trusted instruction to prioritize and state coverage as "Reviewed X of N changed files".
5. **Trusted/untrusted split**: the coverage instruction and counts are trusted; excluded file paths are attacker-controlled and are rendered as data in the UNTRUSTED diff section, preserving ADR-003.
6. **Replace the `fileCount > 50` nudge**: the hard-coded agentic nudge is replaced by the configurable threshold-driven note.

## Alternatives Considered

### Chunked multi-session review
- Pros: Full coverage of every file across passes
- Cons: Multiple Jules sessions per PR, result merging, much larger orchestration change, hard to test without a live SDK, burns session budget
- Rejected: Coverage-priority selection is deterministic, mock-testable, and satisfies the acceptance criteria; chunking is future work

### File-count cap (CodeRabbit-style 150–300 files)
- Pros: Simple, matches market leader
- Cons: Ignores diff size, which is what actually bounds the prompt; a few huge files are worse than many small ones
- Rejected: Char-budget packing by churn is the direct cause of the truncation problem

### `.gitignore`-aware automatic skips
- Pros: Removes noise before selection
- Cons: Overlaps with the existing `ignored_paths` input; silently dropping files conflicts with explicit coverage reporting
- Rejected: Keep `ignored_paths` as the only path-filtering surface

## Consequences
- Default behaviour changes: large PRs are no longer silently truncated; they get a prioritized subset plus an explicit coverage note in the posted comment.
- `large_pr_strategy: truncate` restores the legacy cut for existing users, now with coverage reporting.
- Agentic mode reports coverage by instruction; prompt mode also reports it deterministically.
- Prompts remain testable without a Jules session (selection + prompt construction unit tests).
- The prompt builder's agentic `fileCount` argument is removed; index still passes the changed-file list to `runAgenticReview` for post-hoc verification.
