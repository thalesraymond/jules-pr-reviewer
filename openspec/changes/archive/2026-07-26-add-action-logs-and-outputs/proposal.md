# Proposal: Add Action Logs and Outputs

## Why

Consumers of the `jules-pr-reviewer` action currently have limited visibility into the runtime behavior of the review pipeline. Log messages are written only through the basic `@actions/core` helpers and do not expose machine-readable metadata such as review verdict, duration, or issue counts. Downstream workflows cannot react to review results because no action outputs are emitted. By adding structured internal logs and well-defined action outputs, we make the action easier to troubleshoot, simpler to integrate into automation, and ready for future telemetry improvements—without changing the existing PR comment format.

## What Changes

- Add a small, dependency-free structured-logging helper that writes JSON payloads to the GitHub Actions log through `@actions/core`.
- Instrument key milestones and metrics in the action runner:
  - review started / completed / failed
  - diff fetched and truncated
  - Jules API call duration and outcome
  - review submission result
  - final status state
- Emit GitHub Action outputs that downstream jobs can consume:
  - `verdict`
  - `issues_count`
  - `high_issues_count`
  - `warning_issues_count`
  - `info_issues_count`
  - `session_id`
- Ensure all emitted data goes through a scrubbing layer so secrets, tokens, and untrusted PR inputs are never leaked in logs or outputs.
- Update tests to cover log and output emission.
- Update `README.md` and `action.yml` to document new outputs.

## Capabilities

### New Capabilities

- `action-logs-and-outputs`: Structured action logging and GitHub Action output emission for review results, enabling troubleshooting and downstream automation.

### Modified Capabilities

<!-- No existing spec-level requirements change. -->

## Impact

- **Code**: `src/index.ts` will receive instrumentation calls; a new `src/logging.ts` module will be introduced; `src/types.ts` may gain a small output shape type if needed.
- **API surface**: New action outputs added to `action.yml`; no existing inputs are changed.
- **Dependencies**: No new runtime or development dependencies.
- **Downstream workflows**: Consumers can now reference output values in subsequent steps, e.g., `steps.jules.outputs.verdict`.
