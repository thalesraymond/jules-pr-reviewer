## Purpose

Lets Jules inspect the PR head branch directly instead of receiving the diff embedded in the prompt, removing the diff-size ceiling and giving it full repository context for review.

## ADDED Requirements

### Requirement: diff_mode input

The action SHALL support a `diff_mode` string input with values `prompt` (default) and `agentic`. When `prompt`, the existing pipeline runs unchanged. When `agentic`, the action uses the agentic review pipeline.

#### Scenario: Default diff_mode
- **WHEN** the action runs without an explicit `diff_mode` input
- **THEN** `diff_mode` resolves to `prompt`
- **AND** the existing prompt-mode pipeline executes

#### Scenario: Agentic diff_mode
- **WHEN** `diff_mode: agentic` is set in the workflow
- **THEN** the action uses the agentic review pipeline

#### Scenario: Invalid diff_mode
- **WHEN** `diff_mode` is set to a value other than `prompt` or `agentic`
- **THEN** the action fails with a clear error message

---

### Requirement: Agentic prompt contract

When `diff_mode: agentic`, the action SHALL construct a prompt that instructs Jules to run `git diff <base_sha>...<head_sha>` to obtain the diff. The prompt SHALL include:

1. **SHA-based diff instruction:** Primary instruction uses `<base_sha>...<head_sha>`. If Jules cannot resolve the SHA, it SHALL fall back to inferring base/head refs from its session context.
2. **Read-only prohibition:** A SECURITY section at the top of the prompt SHALL state that Jules MUST NOT modify, create, or delete any files in the repository.
3. **`ignored_paths`:** The list of ignored paths SHALL be provided in the prompt with instructions to merge it with the project's `.gitignore` files when reviewing. The action-side filter (`filterDiff`) remains active as a defence-in-depth measure.
4. **Large-PR nudge:** When >50 files are changed, the prompt SHALL include a soft nudge instructing Jules to prioritize high-impact/high-confidence reviews. No hard truncation applies in agentic mode (the 80 KB limit is dropped).
5. **UNTRUSTED labels:** PR title, description, diff instructions, rules file, and ignored_paths SHALL all be labeled UNTRUSTED to defend against prompt injection.

#### Scenario: SHA-based diff instruction
- **WHEN** the agentic prompt is constructed
- **THEN** the prompt contains `git diff <base_sha>...<head_sha>` as the primary diff instruction
- **AND** the prompt contains a fallback instruction for when SHAs cannot be resolved

#### Scenario: Read-only prohibition
- **WHEN** the agentic prompt is constructed
- **THEN** the SECURITY section contains an explicit prohibition against modifying, creating, or deleting files

#### Scenario: ignored_paths in prompt
- **WHEN** `ignored_paths` is configured and `diff_mode` is `agentic`
- **THEN** the ignored paths list appears in the prompt with merge-with-gitignore instructions

#### Scenario: Large-PR nudge
- **WHEN** the PR changes more than 50 files and `diff_mode` is `agentic`
- **THEN** the prompt includes a soft nudge to prioritize high-impact reviews
- **AND** no 80 KB truncation is applied to the diff

#### Scenario: Small PR no nudge
- **WHEN** the PR changes 50 or fewer files and `diff_mode` is `agentic`
- **THEN** no large-PR nudge appears in the prompt

---

### Requirement: changedFiles in ReviewResult

The `ReviewResult` type SHALL include an optional `changedFiles` field of type `string[]`. When present, it contains the list of files Jules reports having reviewed. The action SHALL log this field but SHALL NOT enforce completeness against it.

#### Scenario: Jules returns changedFiles
- **WHEN** Jules returns a review with `changedFiles: ["src/foo.ts", "src/bar.ts"]`
- **THEN** `parseReviewResponse` includes `changedFiles` in the parsed result
- **AND** the action logs the changedFiles list

#### Scenario: Jules omits changedFiles
- **WHEN** Jules returns a review without a `changedFiles` field
- **THEN** `parseReviewResponse` sets `changedFiles` to `undefined`
- **AND** the action proceeds normally

---

### Requirement: changedFiles mismatch is informational (no fallback)

Differences between the files Jules reports reviewing (`changedFiles`) and the actual changed-file set SHALL NOT trigger a fallback or a retry. The action SHALL log a human-readable line and a structured `verification_mismatch` event so the user is informed, then proceed with the agentic review.

#### Scenario: Partial changedFiles — fewer files reported than actual
- **WHEN** Jules returns a review with `changedFiles` that is a strict subset of the actual changed files
- **THEN** the action logs a `verification_mismatch` event with `{ tier: "partial", reportedCount, actualCount }`
- **AND** the action proceeds with the agentic review (no fallback, no retry)

#### Scenario: Empty or missing changedFiles
- **WHEN** Jules returns a review with `changedFiles` absent or empty (`[]`)
- **THEN** the action logs a `verification_mismatch` event with `{ tier: "empty", reportedCount, actualCount }`
- **AND** the action proceeds with the agentic review (no fallback, no retry)

#### Scenario: Extra-only changedFiles — superset
- **WHEN** Jules returns a review with `changedFiles` that is a superset of the actual changed files (every real file covered, plus extras)
- **THEN** the action logs a `verification_mismatch` event with `{ tier: "extra_only", reportedCount, actualCount }`
- **AND** the action proceeds with the agentic review

---

### Requirement: Agentic fallback triggers

The action SHALL fall back from agentic to prompt mode on the following conditions. On fallback, the agentic review result is discarded and the prompt-mode result is authoritative.

#### Scenario: Session-creation failure
- **WHEN** `jules.session()` throws (deleted head branch, rejected branch name, transient 5xx, rate-limit)
- **THEN** the action falls back to prompt mode immediately
- **AND** no agentic retry is attempted
- **AND** a structured log event `agentic_fallback` is emitted with `{ reason: "session_creation_failed" }`

#### Scenario: Agentic timeout
- **WHEN** the agentic session exhausts its `timeoutMinutes` budget
- **THEN** the action falls back to prompt mode
- **AND** the prompt fallback uses the full `timeoutMinutes` budget
- **AND** a structured log event `agentic_fallback` is emitted with `{ reason: "timeout" }`

---

### Requirement: Session archiving

The action SHALL archive every Jules session it creates (agentic or prompt-fallback) once it is done with it. Archiving is best-effort: a failed archive SHALL NOT fail the review.

#### Scenario: Successful agentic session archived
- **WHEN** an agentic session completes successfully
- **THEN** the action calls `session.archive()` in a try/catch
- **AND** an archive failure is logged but does not affect the review

#### Scenario: Abandoned agentic session archived on fallback
- **WHEN** the action falls back from agentic to prompt mode
- **THEN** the abandoned agentic session is archived best-effort
- **AND** the archive failure is logged but does not block the fallback

#### Scenario: Prompt-fallback session archived
- **WHEN** a prompt-fallback session completes
- **THEN** the session is archived best-effort

---

### Requirement: Agentic prompt-mode fallback pipeline

When fallback triggers, the action SHALL re-run the full prompt-mode pipeline (fetch diff, build prompt, run Jules, parse, submit). The prompt fallback SHALL use the full `timeoutMinutes` budget.

#### Scenario: Fallback re-runs prompt pipeline
- **WHEN** agentic mode falls back to prompt mode
- **THEN** the action fetches the diff, builds a prompt-mode prompt, creates a new Jules session, and runs the full review pipeline
- **AND** the prompt-mode result is authoritative (agentic result is discarded)
- **AND** exactly one review is posted to the PR

#### Scenario: Fallback overwrites pending status
- **WHEN** fallback triggers while the status is still `pending`
- **THEN** the prompt-mode pipeline's final `setStatus` overwrites the pending status
