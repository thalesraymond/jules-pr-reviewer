# Sentinel Log

## 2026-06-18
- **Vulnerability/Learning/Prevention**: Fixed a Comment Spoofing vulnerability via String Includes in `fetchOpenThreads` where an attacker could spoof Jules's inline comments by creating a normal comment with the HTML string `<!-- jules-inline-comment -->`. Mitigated by asserting `viewerDidAuthor` in the GraphQL pull request review thread comments node to reliably authenticate that the bot specifically authored the comment.

## 2026-06-24 - Missing explicit secret masking for GitHub tokens
**Vulnerability:** The action did not explicitly call `core.setSecret` for the `github_token` input, relying solely on GitHub Actions' automatic heuristic masking which may not reliably catch dynamically generated tokens or specific permutations of tokens in custom formats.
**Learning:** We must not rely on GitHub's implicit masking heuristics for sensitive secrets, particularly auth tokens. The `github_token` acts as a critical credential granting broad access (including write and repository manipulation) to the target repository.
**Prevention:** Always explicitly call `core.setSecret(token)` for any action input that represents a token, API key, or other secret (like `github_token` or `jules_api_key`) immediately after retrieving it with `core.getInput`, regardless of GitHub's built-in heuristics. Add explicit tests to ensure `setSecret` is tracked and called for these secrets.
