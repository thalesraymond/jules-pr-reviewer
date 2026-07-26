# Tasks: Add Action Logs and Outputs

## 1. Define Types and Contracts

- [x] 1.1 Add a `ReviewOutputs` type to `src/types.ts` describing the action outputs.
- [x] 1.2 Define a `StructuredLogEntry` type and an allowed event-name union for the logging helper.

## 2. Build the Logging Module

- [x] 2.1 Create `src/logging.ts` with `logStructured(event, payload)` and `setReviewOutputs(outputs)` helpers.
- [x] 2.2 Implement scrubbing logic that masks tokens, the API key, and any raw untrusted PR fields.
- [x] 2.3 Write unit tests for `src/logging.ts` covering structured log format and scrubbing.

## 3. Instrument the Action Runner

- [x] 3.1 Import the logging helpers into `src/index.ts` and start a review timer at the top of `run()`.
- [x] 3.2 Emit `review_started` when input validation passes and `review_completed` / `review_failed` at the end of `run()`.
- [x] 3.3 Emit `jules_api_called` around the `runJulesReview()` call with duration and outcome.
- [x] 3.4 Emit `review_submitted` after `submitReview()` resolves.
- [x] 3.5 Set action outputs in the success path and in every early-skip path (draft, fork, bypass).

## 4. Update Action Metadata and Documentation

- [x] 4.1 Add the new action outputs to `action.yml`.
- [x] 4.2 Update `README.md` with an outputs reference and a usage example that reads `steps.jules.outputs.verdict`.

## 5. Integration and Verification

- [x] 5.1 Update `tests/index.test.ts` to assert that structured logs and outputs are emitted for the happy path and skip paths.
- [x] 5.2 Run `pnpm lint` and fix any issues.
- [x] 5.3 Run `pnpm format:check` and apply formatting if needed.
- [x] 5.4 Run `pnpm test` and make all tests pass.
- [x] 5.5 Run `pnpm coverage` and confirm all thresholds stay at 90% or higher.
- [x] 5.6 Run `pnpm build` and verify `dist/index.js` is regenerated.
- [x] 5.7 Stage `dist/index.js` and update the change proposal with any deviations if necessary.
