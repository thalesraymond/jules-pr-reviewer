# Context — jules-pr-reviewer

## Domain modules

**Config module** (`src/config.ts`) — loads and validates action inputs. Exports `loadConfig` which reads from an injected input-reader and returns a `ConfigResult` (`ok`/`error`), never throwing. Hides input reads, defaults (mirrored from `action.yml`), validation (including the `min_severity_to_report`/`block_on` severity gates and the `strictness` profile enum), empty-string normalization (`rules_file`, `extra_instructions`, `ignored_paths`, `ignore_title_keywords`, `ignore_authors`, `review_labels`), and the secret envelope (`setSecret` masking plus the `process.env` wiring that `logging.ts`'s scrubber redacts against).

**Resilience module** (`src/resilience.ts`) — handles transient and permanent failures in external API calls. Exports `withRetry` (exponential backoff for transient errors), `withFallback` (switch to alternative operation on permanent failure), and `isRetryableGithubError` (classify a GitHub API error as transient — `5xx`/`429`/rate-limit — so auth and permission errors fail fast instead of burning retries).

**Validation module** (`src/validation.ts`) — parses and validates LLM responses. Exports `parseReviewResponse` which extracts JSON from markdown and validates the review structure in one call.

**Filtering module** (`src/filtering.ts`) — narrows the diff scope based on ignored paths. Exports `parseListInput` (generic list parsing shared by every list input — JSON array or comma/newline-separated), `parseIgnoredPaths` (parse config input), and `filterDiff` (apply path filters). The per-path matching logic (`shouldIgnorePath`) is hidden as an implementation detail.

**Ignore module** (`src/ignore.ts`) — PR-level skip policy. Exports `shouldIgnoreTitle` (case-insensitive substring keywords), `shouldIgnoreAuthor` (login list), and `evaluateLabelPolicy` (allow/deny labels with a `-` deny prefix; only evaluable when the event payload carries PR labels, otherwise warn-and-continue).

**Severity module** (`src/severity.ts`) — severity ordering and gating. Exports `parseSeverityGate` (config value → `Severity`), `filterCommentsBySeverity` (drop findings below `min_severity_to_report`), and `hasFindingsAtOrAbove` (finding-based `block_on` blocking).

**Rules module** (`src/pathRules.ts`) — per-path review instructions. Exports `loadPerPathRules` which discovers `.md` rule files in the `rules_directory` at the base SHA (via `github.ts`'s `listFilesInDirectory`), derives a path glob from each file's path relative to the directory, keeps only rules whose glob matches ≥1 changed file, and loads their contents (`PathRuleFile[]`). The glob helpers (`isRuleFile`, `globFromRulePath`, `isWellFormedGlob`) and matching (`selectMatchingRules`) are exported for unit testing; malformed globs and unreadable files warn (`core.warning`) instead of failing the review. `prompt.ts` merges global `rules_file` content and per-path rules into one UNTRUSTED-fenced "Project-specific rules" section.

**Coverage module** (`src/coverage.ts`) — large-PR handling. Exports `preparePromptDiff` (select a subset of the diff within a char budget — greedy pack by churn for `prioritize`, original-order cut for `truncate` — plus a coverage report of included/partial/excluded files), `splitDiffSections` (parse `diff --git` boundaries), and `buildPostedCoverageNote` (deterministic coverage line appended to the posted review).

**Errors module** (`src/errors.ts`) — cross-cutting error handling. Exports `getErrorMessage` (extract a message from Error objects, message-bearing objects, and raw values), the failure taxonomy (`FailureKind`, `ReviewFailure`, `QuotaExceededError`, `AuthError`, `QUOTA_HINT`), `isQuotaError` / `isAuthError` classifiers, and `classifyFailure` which maps any thrown value to `{ kind, stage, message, summary }` so the check run and structured log describe the root cause. `timeoutExitSummary` is the shared wording for the no-review timeout exit.

**Session module** (`src/session.ts`) — runs one fresh or reused Jules session to completion: creates and waits for readiness, or reopens a completed/awaiting-feedback/paused session, logs its state, unarchives it, snapshots prior activity IDs, and sends a follow-up. Polls for a new review, parses it, and archives on every exit after adoption; rejected busy/inaccessible candidates are untouched. Exports `runSession` which reports its outcome as `review`, `timeout`, or `creation_failed` (including reuse setup/send failures). It wraps Jules quota/auth errors into the typed `QuotaExceededError`/`AuthError` (classifiers live in `src/errors.ts`) and logs unparseable responses as `review_failed` with `kind: "parse"`.

**Session reuse storage** (`src/sessionReuse.ts`) — finds the authenticated token owner's latest Jules PR review across all review pages. A deterministic marker before model-generated text records session ID, follow-up count, and review mode. Rejects exhausted, malformed, or mode-incompatible markers without resurrecting an older session. Lookup failure warns and starts fresh. See ADR-022.

**Review execution module** (`src/executeReview.ts`) — owns prompt construction,
mode selection, timeout-only fresh prompt retry, bounded reuse recovery, agentic-to-prompt fallback, and
informational changed-file verification behind `executeReview`. Single-session
lifecycle remains in the session module. Execution emits exactly one
`jules_api_called` completion event across all attempts, including cleanup, with
elapsed milliseconds and success only for a valid parsed review. Callers receive
the review, final session ID, and prompt coverage; telemetry is not caller work.
See ADR-021 for scope and compatibility constraints.

**Submission module** (`src/submission.ts`) — formats and submits review comments to GitHub. Exports `submitReview` which handles the 3-tier fallback ladder (with suggestions → without suggestions → summary-only), XSS sanitization, suggestion escaping, and comment formatting, and returns the accepted **review delivery state** (plus whether a fallback degraded delivery). The body of the accepted attempt carries the matching fallback note. The formatting pipeline (severity emojis, confidence indicators, prompt-for-agents collapsible blocks) is hidden as an implementation detail.

**Strictness module** (`src/strictness.ts`) — the strictness profile dial. Exports `meetsReportThreshold` (which severities surface at a given level: `quiet` → High only, `chill`/`assertive` → everything) and `filterCommentsByStrictness` (applies the threshold to a comment list). The prompt-side per-level instructions live in `src/prompt.ts` as trusted text; `chill` renders no block so the default prompt is unchanged.

## Key concepts

**Review preparation** — gathering the diff, changed files, applicable base-commit rules, and open threads for a PR review. The review mode and event determine whether the diff covers the full PR or only the latest push; rules always come from the PR base commit.

**Review execution** — producing one review from prepared PR context, including
all Jules session attempts needed by the selected mode and its fallback. It ends
after session cleanup, before GitHub review submission. A blocking verdict is
still a successful execution; an unparseable-response fallback review is not.

**ReviewResult** — the structured output from the LLM: verdict (approve/comment/block), summary, resolved comment IDs, and new comments with file/line/severity/confidence/message.

**Strictness profile** — the review-culture dial (`quiet` | `chill` | `assertive`): steers the prompt (per-level trusted instruction block) and the report threshold (which severities surface). `chill` is the default and renders no block, keeping the prompt byte-identical to earlier versions.

**Jules session** — a conversation on the Jules side that receives a review prompt and produces a review message. With opt-in reuse, it can receive bounded follow-up review requests for the same PR.

**OpenThread** — a previously-posted review comment that is still unresolved. Tracked by index so the LLM can mark them as fixed (`resolvedCommentIds`) and, when `dedupe` is enabled, told not to re-report them in `newComments`.

**Incremental diff** — on synchronize events, the diff between the previous head and the new head, not the full PR diff.

**ReviewCoverage** — the large-PR coverage report: whether the PR is large, how many files were reviewed, and which files were excluded (prompt mode) so the review can state explicit coverage instead of silently truncating the diff.

**Skip decision** — a PR-level early return driven by the ignore inputs: title keyword match, author match, or label allow/deny policy. Skip decisions run before any GitHub/Jules API call, so skipped PRs never create a check run or session.

**Review delivery state** — what readers actually received from a submitted review: inline findings with suggestions, inline findings without suggestions, or a summary without inline findings. Only a fallback that loses suggested changes or inline findings is degraded delivery; a review without suggestions or findings can be intentional. Delivery state is distinct from the review verdict and the number of findings reported by Jules.
