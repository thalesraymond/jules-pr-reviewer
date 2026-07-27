# ADR-005: Three-tier review submission fallback ladder

## Status
Accepted

## Date
2026-07-25

## Context
The GitHub review API (`octokit.rest.pulls.createReview()`) can return 422 for various reasons: a suggestion block references a line outside the diff hunk, `startLine > line`, or malformed suggestion content. Without graceful degradation, the entire review is lost — no comments are posted at all. We need resilience: some review is better than no review.

## Decision
Implement a 3-tier fallback ladder using nested `withFallback` calls:
- **Tier 1 (primary):** Submit review with all comments, including one-click suggestions (if `enable_suggestions` is true).
- **Tier 2 (fallback on 422):** Strip suggestion fields from all comments and retry submission. This handles line-range and hunk-boundary issues.
- **Tier 3 (fallback on 422):** Submit a summary-only review (no inline comments). This handles cases where even stripped comments fail validation.

The `withFallback` utility wraps a primary function with a fallback that runs only when the primary throws a specified error.

## Alternatives Considered

### Validate all comments before submission
- Pros: Prevents failed submissions
- Cons: Cannot predict all GitHub API validation rules (they change); fallback is more robust
- Rejected: GitHub API validation rules are opaque and change without notice

### Single fallback to summary-only
- Pros: Simpler implementation
- Cons: Strips useful inline comments when only suggestions are the problem (Tier 2 preserves non-suggestion comments)
- Rejected: Loses valuable line-level feedback unnecessarily

### Retry with backoff
- Pros: Handles transient failures
- Cons: 422 is a validation error, not a transient failure; retrying the same payload won't help
- Rejected: No retry will fix an invalid payload

## Consequences
- The `submitReview` function in `github.ts` composes two `withFallback` calls
- Tests verify each tier independently
- The T3 summary review loses line-level context but preserves the overall verdict and summary
- Partial results are always preferable to no results
