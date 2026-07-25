# Tasks: Add Action Logs and Outputs

## 1. Define Types and Contracts

- [ ] 1.1 Add a `ReviewOutputs` type to `src/types.ts` describing the action outputs.
- [ ] 1.2 Define a `StructuredLogEntry` type and an allowed event-name union for the logging helper.

## 2. Build the Logging Module

- [ ] 2.1 Create `src/logging.ts` with `logStructured(event, payload)` and `setReviewOutputs(outputs)` helpers.
- [ ] 2.2 Implement scrubbing logic that masks tokens, the API key, and any raw untrusted PR fields.
- [ ] 2.3 Write unit tests for `src/logging.ts` covering structured log format and scrubbing.

## 3. Instrument the Action Runner

- [ ] 3.1 Import the logging helpers into `src/index.ts` and start a review timer at the top of `run()`.
- [ ] 3.2 Emit `review_started` when input validation passes and `review_completed` / `review_failed` at the end of `run()`.
- [ ] 3.3 Emit `jules_api_called` around the `runJulesReview()` call with duration and outcome.
- [ ] 3.4 Emit `review_submitted` after `submitReview()` resolves.
- [ ] 3.5 Set action outputs in the success path and in every early-skip path (draft, fork, bypass).

## 4. Update Action Metadata and Documentation

- [ ] 4.1 Add the new action outputs to `action.yml`.
- [ ] 4.2 Update `README.md` with an outputs reference and a usage example that reads `steps.jules.outputs.verdict`.

## 5. Integration and Verification

- [ ] 5.1 Update `tests/index.test.ts` to assert that structured logs and outputs are emitted for the happy path and skip paths.
- [ ] 5.2 Run `pnpm lint` and fix any issues.
- [ ] 5.3 Run `pnpm format:check` and apply formatting if needed.
- [ ] 5.4 Run `pnpm test` and make all tests pass.
- [ ] 5.5 Run `pnpm coverage` and confirm all thresholds stay at 90% or higher.
- [ ] 5.6 Run `pnpm build` and verify `dist/index.js` is regenerated.
- [ ] 5.7 Stage `dist/index.js` and update the change proposal with any deviations if necessary.
