# Context — jules-pr-reviewer

## Domain modules

**Resilience module** (`src/resilience.ts`) — handles transient and permanent failures in external API calls. Exports `withRetry` (exponential backoff for transient errors) and `withFallback` (switch to alternative operation on permanent failure).

**Validation module** (`src/validation.ts`) — parses and validates LLM responses. Exports `parseReviewResponse` which extracts JSON from markdown and validates the review structure in one call.

**Filtering module** (`src/filtering.ts`) — narrows the diff scope based on ignored paths. Exports `parseIgnoredPaths` (parse config input) and `filterDiff` (apply path filters). The per-path matching logic (`shouldIgnorePath`) is hidden as an implementation detail.

**Errors module** (`src/errors.ts`) — cross-cutting error message extraction. Exports `getErrorMessage` which handles Error objects, objects with message properties, and raw values.

**Session module** (`src/session.ts`) — runs a single Jules session to completion: creates the session, waits for it to be ready, polls for the review message, parses the response, and archives the session on every exit. Exports `runSession` which reports its outcome as `review`, `timeout`, or `creation_failed`, plus `isAuthError` for classifying Jules API auth failures.

**Submission module** (`src/submission.ts`) — formats and submits review comments to GitHub. Exports `submitReview` which handles the 3-tier fallback ladder (with suggestions → without suggestions → summary-only), XSS sanitization, suggestion escaping, and comment formatting. The formatting pipeline (severity emojis, confidence indicators, prompt-for-agents collapsible blocks) is hidden as an implementation detail.

## Key concepts

**ReviewResult** — the structured output from the LLM: verdict (approve/comment/block), summary, resolved comment IDs, and new comments with file/line/severity/confidence/message.

**Jules session** — a single unit of work on the Jules side: a created session that receives the review prompt and produces a review message.

**OpenThread** — a previously-posted review comment that is still unresolved. Tracked by index so the LLM can mark them as fixed.

**Incremental diff** — on synchronize events, the diff between the previous head and the new head, not the full PR diff.
