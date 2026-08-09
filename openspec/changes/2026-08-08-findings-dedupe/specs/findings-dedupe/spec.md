## Purpose

Prevents the reviewer from re-reporting its own previously posted, still-unresolved findings on subsequent pushes, while keeping a configurable escape hatch.

## ADDED Requirements

### Requirement: dedupe input

The action SHALL support a `dedupe` boolean input, defaulting to `true`. When enabled, the review prompt instructs the LLM not to re-report its own still-open findings.

#### Scenario: Default dedupe
- **WHEN** the action runs without an explicit `dedupe` input
- **THEN** `dedupe` resolves to `true`

#### Scenario: dedupe disabled
- **WHEN** `dedupe: false` is set in the workflow
- **THEN** the review prompt omits the dedupe instruction

#### Scenario: Invalid dedupe value
- **WHEN** `dedupe` is set to a value that is not a YAML boolean
- **THEN** the action fails with a clear error message

---

### Requirement: Deduplication prompt instruction

When `dedupe` is enabled and the action has prior open threads of its own, the prompt SHALL include a trusted instruction stating that the listed open findings are already reported and MUST NOT be re-reported in `newComments`.

The instruction SHALL cover:

1. **Resolve, don't repeat:** If the current diff fixes a listed finding, its index SHALL go into `resolvedCommentIds` instead of being re-reported.
2. **Leave unchanged findings alone:** If a listed finding is unchanged, it MUST NOT be repeated.
3. **Materially new instances only:** A new comment SHALL be emitted only when the current diff introduces a new or materially different instance of the problem.
4. **Open-thread list always rendered:** The open-thread list SHALL be rendered regardless of `dedupe`, so that thread resolution (`resolvedCommentIds`) keeps working.

#### Scenario: dedupe on with open threads
- **WHEN** `dedupe` is enabled and open threads exist
- **THEN** the prompt contains the dedupe instruction and the open-thread list

#### Scenario: dedupe off with open threads
- **WHEN** `dedupe` is disabled and open threads exist
- **THEN** the prompt contains the open-thread list but NOT the dedupe instruction

#### Scenario: no open threads
- **WHEN** the action has no open threads of its own
- **THEN** neither the open-thread list nor the dedupe instruction appears

---

### Requirement: Zero-delta scoping

The action SHALL keep already-reviewed files/hunks out of subsequent reviews by presenting only the incremental diff on `synchronize` events (`payload.before → head`). This is satisfied by the existing incremental-diff behaviour; no additional filtering is introduced by this change.

#### Scenario: synchronize event
- **WHEN** a `synchronize` event arrives
- **THEN** only the diff from `payload.before` to `head` is presented for review
