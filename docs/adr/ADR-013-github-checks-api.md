# ADR-013: Adopt GitHub Checks API for review status

## Status
Accepted

## Date
2026-08-07

## Context
Reviews previously surfaced via the legacy commit **status** API (`jules/review` context, pending → success/failure). This approach has limitations:

- **Poor UX**: Status checks show only pass/fail/error in the PR UI — no inline visibility into findings.
- **No annotations**: Review findings cannot appear directly in the diff view via the checks tab.
- **Branch protection friction**: While commit statuses work with branch protection, the Checks API provides a richer merge-queue experience with detailed failure reasons.

CodeRabbit and Copilot review both use check runs with annotations, setting user expectations for this UX pattern. We need parity: findings visible in the checks tab, satisfying branch protection with better diagnostics.

## Decision
Replace the legacy commit-status API with the GitHub Checks API:

1. **Check run lifecycle**: Create an `in_progress` check run at review start (`createCheckRun`), then update it to `completed` with a conclusion (`finalizeCheckRun`).
2. **Annotations**: Emit annotations from parsed review findings, mapping severity to annotation level:
   - `High` → `failure`
   - `Warning` → `warning`
   - `Info` → `notice`
3. **Annotation limits**: Cap annotations at 50 per check run (GitHub's practical limit for readability; the API allows up to 50 per request).
4. **Permission migration**: Require `checks: write` instead of `statuses: write`.
5. **Backward compatibility**: The `fail_on` mapping (never/blocking/any → success/failure) is preserved. Outputs remain unchanged.

The `statusFromVerdict` function is renamed to `conclusionFromVerdict` to reflect the Checks API terminology (`conclusion` instead of `state`).

## Alternatives Considered

### Keep commit status API
- Pros: No breaking change for existing workflows, simpler permission model (`statuses: write`)
- Cons: No inline annotations, poor UX in checks tab, falling behind industry standards (CodeRabbit, Copilot)
- Rejected: Users expect annotations in the checks tab; commit status is legacy

### Hybrid approach (commit status + check run)
- Pros: Backward compatible, gradual migration path
- Cons: Double API calls, confusing to users (two status indicators), maintenance burden
- Rejected: Adds complexity without clear benefit; users should migrate to checks

### Use GraphQL Checks API
- Pros: More flexible, single request for complex queries
- Cons: REST API is sufficient for our use case, GraphQL adds complexity, REST is more widely documented
- Rejected: REST API meets all requirements; GraphQL is overkill

## Consequences
- **Breaking change**: Existing workflows must update permissions from `statuses: write` to `checks: write`. Documented in README and action.yml.
- **Richer UX**: Findings appear as annotations in the checks tab, visible directly in the diff view.
- **Branch protection**: Users must update branch protection rules from "Require status checks" to "Require check runs to pass" (same check name: `jules/review`).
- **Annotation cap**: Maximum 50 annotations per check run. If a review has more than 50 findings, only the first 50 are annotated (all findings still appear in the PR review comment).
- **Error handling**: If check run creation fails (e.g., permission error), the action fails fast with a clear message. If finalization fails, the error is logged but does not block the review submission.
- **No functional regression**: The `fail_on` logic, outputs, and review submission pipeline remain unchanged.
