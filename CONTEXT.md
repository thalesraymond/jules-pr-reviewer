# Context — jules-pr-reviewer

## Domain modules

**Config module** (`src/config.ts`) — loads and validates action inputs. Exports `loadConfig` which reads from an injected input-reader and returns a `ConfigResult` (`ok`/`error`), never throwing. Hides input reads, defaults (mirrored from `action.yml`), validation, empty-string normalization (`rules_file`, `extra_instructions`, `ignored_paths`), and the secret envelope (`setSecret` masking plus the `process.env` wiring that `logging.ts`'s scrubber redacts against).

**Resilience module** (`src/resilience.ts`) — handles transient and permanent failures in external API calls. Exports `withRetry` (exponential backoff for transient errors), `withFallback` (switch to alternative operation on permanent failure), and `isRetryableGithubError` (classify a GitHub API error as transient — `5xx`/`429`/rate-limit — so auth and permission errors fail fast instead of burning retries).

**Validation module** (`src/validation.ts`) — parses and validates LLM responses. Exports `parseReviewResponse` which extracts JSON from markdown and validates the review structure in one call.

**Filtering module** (`src/filtering.ts`) — narrows the diff scope based on ignored paths. Exports `parseIgnoredPaths` (parse config input) and `filterDiff` (apply path filters). The per-path matching logic (`shouldIgnorePath`) is hidden as an implementation detail.

**Coverage module** (`src/coverage.ts`) — large-PR handling. Exports `preparePromptDiff` (select a subset of the diff within a char budget — greedy pack by churn for `prioritize`, original-order cut for `truncate` — plus a coverage report of included/partial/excluded files), `splitDiffSections` (parse `diff --git` boundaries), and `buildPostedCoverageNote` (deterministic coverage line appended to the posted review).

**Errors module** (`src/errors.ts`) — cross-cutting error handling. Exports `getErrorMessage` (extract a message from Error objects, message-bearing objects, and raw values), the failure taxonomy (`FailureKind`, `ReviewFailure`, `QuotaExceededError`, `AuthError`, `QUOTA_HINT`), `isQuotaError` / `isAuthError` classifiers, and `classifyFailure` which maps any thrown value to `{ kind, stage, message, summary }` so the check run and structured log describe the root cause. `timeoutExitSummary` is the shared wording for the no-review timeout exit.

**Session module** (`src/session.ts`) — runs a single Jules session to completion: creates the session, waits for it to be ready, polls for the review message, parses the response, and archives the session on every exit. Exports `runSession` which reports its outcome as `review`, `timeout`, or `creation_failed`. It wraps Jules quota/auth errors into the typed `QuotaExceededError`/`AuthError` (classifiers live in `src/errors.ts`) and logs unparseable responses as `review_failed` with `kind: "parse"`.

**Submission module** (`src/submission.ts`) — formats and submits review comments to GitHub. Exports `submitReview` which handles the 3-tier fallback ladder (with suggestions → without suggestions → summary-only), XSS sanitization, suggestion escaping, and comment formatting. The formatting pipeline (severity emojis, confidence indicators, prompt-for-agents collapsible blocks) is hidden as an implementation detail.

## Key concepts

**ReviewResult** — the structured output from the LLM: verdict (approve/comment/block), summary, resolved comment IDs, and new comments with file/line/severity/confidence/message.

**Jules session** — a single unit of work on the Jules side: a created session that receives the review prompt and produces a review message.

**OpenThread** — a previously-posted review comment that is still unresolved. Tracked by index so the LLM can mark them as fixed (`resolvedCommentIds`) and, when `dedupe` is enabled, told not to re-report them in `newComments`.

**Incremental diff** — on synchronize events, the diff between the previous head and the new head, not the full PR diff.

**ReviewCoverage** — the large-PR coverage report: whether the PR is large, how many files were reviewed, and which files were excluded (prompt mode) so the review can state explicit coverage instead of silently truncating the diff.
