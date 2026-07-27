# ADR-006: Structured logging with secret scrubbing via ::structured:: prefix

## Status
Accepted

## Date
2026-07-25

## Context
The action writes diagnostics via `core.info`, `core.warning`, `core.error`. Human-readable logs are fine for debugging, but calling workflows and log aggregators need machine-readable data. We need structured logs without adding dependencies or changing GitHub Actions log behavior. Critically, we must never leak secrets (GITHUB_TOKEN, JULES_API_KEY) or untrusted PR content in logs.

## Decision
Create a `src/logging.ts` module that:
1. Emits structured JSON entries prefixed with `::structured::` via `core.info`.
2. Recursively scrubs secrets from payloads before emission: replaces `GITHUB_TOKEN` and `JULES_API_KEY` values, redacts diff content, and removes known untrusted fields (`diff`, `prTitle`, `prBody`, `title`, `description`).
3. Uses only `@actions/core` (no external logging library).
4. Emits events at major lifecycle points: `review_started`, `review_completed`, `review_failed`, `jules_api_called`, `review_submitted`.

## Alternatives Considered

### Third-party logger (Winston, Pino)
- Pros: Rich feature set, structured logging built-in
- Cons: Adds dependencies and bundle size; `@actions/core` already provides the primitives needed
- Rejected: Dependency overhead not justified for the limited logging needs

### Write to a separate file
- Pros: Persistent, structured output
- Cons: GitHub Actions doesn't persist arbitrary files; the run log is the canonical output stream
- Rejected: Files would be lost after the action completes

### Unstructured JSON without prefix
- Pros: Simpler implementation
- Cons: Harder to parse from mixed log output; the prefix enables simple grep/awk extraction
- Rejected: Parsing mixed unstructured and structured output is unreliable

## Consequences
- One structured line per major stage (no per-comment spam)
- Consumers parse the log with `grep '::structured::'`
- The scrubber must be updated if new sensitive fields are added
- Tests cover scrubbing of tokens, API keys, diffs, and untrusted fields
