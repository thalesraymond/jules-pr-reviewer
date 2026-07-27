## Purpose

Support automatic retry of the Jules review session on timeout to improve reliability without affecting non-timeout failures.

## Requirements

### Requirement: Single retry on timeout

The action SHALL retry Jules review exactly once when the first attempt times out. A timeout is defined as `pollForReview` returning an empty string (`""`) after exhausting the `timeoutMinutes` budget.

#### Scenario: First attempt times out, second succeeds
- **GIVEN** Jules times out on the first attempt (pollForReview returns "")
- **WHEN** the retry logic is triggered
- **THEN** a fresh Jules session is created with the same prompt and source
- **AND** the retry uses the full `timeoutMinutes` budget (not halved)
- **AND** the action returns the review result from the second session

#### Scenario: Both attempts timeout
- **GIVEN** Jules times out on both the first and second attempts
- **WHEN** the action fails
- **THEN** the error message includes both session IDs (first and second)
- **AND** the error message indicates that 2 attempts were made

#### Scenario: First attempt succeeds
- **GIVEN** the first Jules session produces a review within the timeout
- **WHEN** the retry logic runs
- **THEN** no second session is created
- **AND** the action returns the review result from the first session

### Requirement: Retry only on timeout failures

The action SHALL NOT retry on non-timeout failures. Retry is triggered exclusively when `pollForReview` returns `""` (timeout).

#### Scenario: Auth error on first attempt
- **GIVEN** Jules returns an auth error (401 or 403) on the first attempt
- **WHEN** the error occurs
- **THEN** no retry is attempted
- **AND** the action throws an error immediately

#### Scenario: Parse error on first attempt
- **GIVEN** Jules returns a review that fails JSON parsing or schema validation
- **WHEN** the parse error occurs
- **THEN** no retry is attempted
- **AND** the function returns a fallback review result

#### Scenario: Readiness failure (404 loop)
- **GIVEN** `waitUntilSessionReady` exhausts its 404 polling attempts
- **WHEN** the readiness failure occurs
- **THEN** no retry is attempted
- **AND** the action throws an error

### Requirement: Structured logging on retry

The action SHALL emit structured logging when a retry is triggered.

#### Scenario: Retry is triggered
- **GIVEN** the first attempt timed out
- **WHEN** the retry logic is about to create a fresh session
- **THEN** a `core.info` line is emitted indicating the retry
- **AND** a structured log event is emitted with `{ failedSessionId, attempt }`

#### Scenario: No retry on success
- **GIVEN** the first attempt succeeded
- **WHEN** the action completes normally
- **THEN** no retry-related log events are emitted

### Requirement: Error message includes both session IDs on double-timeout

When both retry attempts exhaust their timeout budgets, the action SHALL provide complete audit trail information.

#### Scenario: Both attempts timeout
- **GIVEN** the first session timed out with a known ID
- **AND** the second session timed out with a known ID
- **WHEN** the action throws an error
- **THEN** the error message includes both session IDs

### Requirement: No changes to external interfaces

The retry logic SHALL be internal to `src/jules.ts`.

#### Scenario: Action inputs unchanged
- **GIVEN** the existing `action.yml` inputs
- **WHEN** the retry feature is implemented
- **THEN** no new inputs are added to `action.yml`
- **AND** `src/index.ts` requires no modifications

#### Scenario: Type definitions unchanged
- **GIVEN** the existing types
- **WHEN** the retry feature is implemented
- **THEN** no new fields are added to `src/types.ts`
