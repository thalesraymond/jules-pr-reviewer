## 2025-02-14 - Missing Explicit Secret Masking for github_token
**Vulnerability:** The `github_token` input was not explicitly masked using `core.setSecret()`.
**Learning:** While GitHub automatically masks the default `secrets.GITHUB_TOKEN`, it may not automatically mask custom Personal Access Tokens (PATs) passed via this input.
**Prevention:** Always explicitly call `core.setSecret()` for any input that represents a token, API key, or secret, regardless of GitHub's automatic masking heuristics.
