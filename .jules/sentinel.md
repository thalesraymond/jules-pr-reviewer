# Sentinel Log

## 2026-06-18
- **Vulnerability/Learning/Prevention**: Fixed a Comment Spoofing vulnerability via String Includes in `fetchOpenThreads` where an attacker could spoof Jules's inline comments by creating a normal comment with the HTML string `<!-- jules-inline-comment -->`. Mitigated by asserting `viewerDidAuthor` in the GraphQL pull request review thread comments node to reliably authenticate that the bot specifically authored the comment.

## 2026-06-24 - Missing explicit secret masking for GitHub tokens
**Vulnerability:** The action did not explicitly call `core.setSecret` for the `github_token` input, relying solely on GitHub Actions' automatic heuristic masking which may not reliably catch dynamically generated tokens or specific permutations of tokens in custom formats.
**Learning:** We must not rely on GitHub's implicit masking heuristics for sensitive secrets, particularly auth tokens. The `github_token` acts as a critical credential granting broad access (including write and repository manipulation) to the target repository.
**Prevention:** Always explicitly call `core.setSecret(token)` for any action input that represents a token, API key, or other secret (like `github_token` or `jules_api_key`) immediately after retrieving it with `core.getInput`, regardless of GitHub's built-in heuristics. Add explicit tests to ensure `setSecret` is tracked and called for these secrets.

## 2026-07-01 - Error message leakage via commit status API
**Vulnerability:** The top-level error handler in `src/index.ts` was passing raw error messages directly into the GitHub commit status description via `setStatus()`. If a runtime error inadvertently contained sensitive information (like unmasked secrets or internal stack trace details), it would be leaked publicly to the pull request's status checks.
**Learning:** Error messages sent to external systems or user-visible surfaces (like GitHub commit statuses, PR comments, or external APIs) should never expose raw internal error details directly. Trust boundaries apply to outgoing data just as much as incoming data.
**Prevention:** Always use generic, secure, static error messages for external-facing systems (e.g., "An error occurred. See action logs for details.") and keep the raw, detailed error messages strictly in internal, protected logs (using `core.error`).
