# Spec: action-logs-and-outputs

## ADDED Requirements

### Requirement: Structured action logging
The action SHALL emit machine-readable structured log entries for key lifecycle events using a helper that serializes log data as JSON and writes it through `@actions/core`.

#### Scenario: Review start is logged
- **WHEN** the action begins processing a `pull_request` event
- **THEN** a structured log event named `review_started` is written with the repository owner, repository name, pull request number, and head SHA.

#### Scenario: Review completion is logged
- **WHEN** a Jules review is processed successfully
- **THEN** a structured log event named `review_completed` is written with the verdict, counts of issues by severity, review session ID, and total review duration in milliseconds.

#### Scenario: Review failure is logged
- **WHEN** the action exits with an error, times out, or receives an invalid Jules response
- **THEN** a structured log event named `review_failed` is written with an error reason and the last completed stage.

#### Scenario: Jules API latency is logged
- **WHEN** the action invokes the Jules review API
- **THEN** a structured log event named `jules_api_called` is written with the call duration in milliseconds and a success or failure indicator.

### Requirement: GitHub Action outputs
The action SHALL emit named GitHub Action outputs that downstream workflow steps can consume. Outputs SHALL be set via `core.setOutput`.

#### Scenario: Verdict output is set
- **WHEN** a Jules review is processed successfully
- **THEN** the output `verdict` is set to one of `approve`, `comment`, or `block`.

#### Scenario: Issue count outputs are set
- **WHEN** a Jules review is processed successfully
- **THEN** the outputs `issues_count`, `high_issues_count`, `warning_issues_count`, and `info_issues_count` are set to the number of new comments emitted by Jules in each severity bucket.

#### Scenario: Session output is set
- **WHEN** a Jules review completes
- **THEN** the output `session_id` is set to the Jules review session ID.

#### Scenario: Skipped reviews still emit outputs
- **WHEN** the action skips a review due to draft, fork, or bypass label configuration
- **THEN** the output `verdict` is set to `skipped` and all numeric outputs are set to `0`.

### Requirement: Secure log scrubbing
The action SHALL ensure that GitHub tokens, API keys, repository secrets, and raw untrusted pull request content do not appear in structured logs or outputs.

#### Scenario: API key is redacted from logs
- **WHEN** any value containing the Jules API key is logged through the structured logger
- **THEN** the value is masked before it reaches the log stream.

#### Scenario: Untrusted diff content is not emitted in outputs
- **WHEN** structured logs or action outputs are written
- **THEN** they do not contain raw diff text, PR descriptions, or PR titles.

### Requirement: No new runtime dependencies
The logging and output capability SHALL rely only on the existing `@actions/core` package and standard Node.js APIs.

#### Scenario: Dependency manifest is unchanged
- **WHEN** the change is implemented
- **THEN** no new package is added to `package.json` or `pnpm-lock.yaml`.
