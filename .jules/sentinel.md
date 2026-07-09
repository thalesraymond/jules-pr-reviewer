# Sentinel Log

## 2026-06-18
- **Vulnerability/Learning/Prevention**: Fixed a Comment Spoofing vulnerability via String Includes in `fetchOpenThreads` where an attacker could spoof Jules's inline comments by creating a normal comment with the HTML string `<!-- jules-inline-comment -->`. Mitigated by asserting `viewerDidAuthor` in the GraphQL pull request review thread comments node to reliably authenticate that the bot specifically authored the comment.

## 2026-06-24 - Missing explicit secret masking for GitHub tokens
**Vulnerability:** The action did not explicitly call `core.setSecret` for the `github_token` input, relying solely on GitHub Actions' automatic heuristic masking which may not reliably catch dynamically generated tokens or specific permutations of tokens in custom formats.
**Learning:** We must not rely on GitHub's implicit masking heuristics for sensitive secrets, particularly auth tokens. The `github_token` acts as a critical credential granting broad access (including write and repository manipulation) to the target repository.
**Prevention:** Always explicitly call `core.setSecret(token)` for any action input that represents a token, API key, or other secret (like `github_token` or `jules_api_key`) immediately after retrieving it with `core.getInput`, regardless of GitHub's built-in heuristics. Add explicit tests to ensure `setSecret` is tracked and called for these secrets.

## 2026-06-25 - Information Exposure in PR Commit Status
**Vulnerability:** The action used to blindly catch errors via a generic `catch(err)` block and pass `err.message` directly into `octokit.rest.repos.createCommitStatus` as the error description, which is then publicly viewable in the PR. This could potentially leak sensitive environment details or API tokens depending on what caused the initial crash.
**Learning:** PR commit status checks are publicly visible. Internal errors (like API authorization failures, fetch errors showing endpoint paths, or raw stack trace strings inadvertently bubbled up) should never be blindly output into these status checks.
**Prevention:** Always use a hardcoded generic error string (e.g. "Review failed. Check GitHub Actions log for details.") for public-facing statuses, and limit the actual detailed/sensitive error text to securely handled local logs like `core.error()`, which are automatically sanitized by GitHub Actions runners.
