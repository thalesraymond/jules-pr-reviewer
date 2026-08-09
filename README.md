# Jules PR Reviewer

A GitHub Action that uses [Google Jules](https://jules.google) (Gemini-powered cloud coding agent) to review pull requests and post the review as a PR comment. Optionally gates merges via a check run.

_Special thanks to [@sanjay3290](https://github.com/sanjay3290) for the original work in the base action_

- Works on any language / framework — Jules is general-purpose.
- Low noise by default: aggressive false-positive filter baked into the prompt.
- Extensible: layer your own rules from the workflow or from a file in the repo.
- **Line-level Comments**: Posts findings directly on the specific lines of code in the PR.
- **Auto-resolves threads**: Automatically resolves its own comments if you fix the issue and push a new commit.
- **Incremental reviews**: Only reviews the new changes between pushes (on `synchronize` events) to save time and tokens.
- **Deduplicates findings**: Never re-reports its own still-open comments on subsequent pushes (disable with `dedupe: false`).

## What a review looks like

Instead of a single monolithic comment, Jules leaves **inline, line-level comments** on the PR:

**On `src/db.js`, line 4:**

> <!-- jules-inline-comment -->
>
> **Severity:** 🚨 High | **Confidence:** 🟢 High
>
> SQL injection — the id parameter is interpolated into the query. Use parameterized queries.

It will also post a general summary as a standard PR comment:

> ## 🤖 Jules Review
>
> Adds a /user lookup endpoint and an /admin check. Three critical security flaws need fixing before merge.
>
> ---
>
> _Session: `...`_

## Setup

### 1. Add your Jules API key as a repo secret

`Settings → Secrets and variables → Actions → New repository secret`

- Name: `JULES_API_KEY`
- Value: key from [jules.google.com](https://jules.google.com) (after authenticating with GitHub)

### 2. Add the workflow

`.github/workflows/pr-review.yml`:

```yaml
name: Jules PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

concurrency:
  group: jules-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
      checks: write
    steps:
      - uses: thalesraymond/jules-pr-reviewer@v1
        with:
          jules_api_key: ${{ secrets.JULES_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

The `concurrency` block cancels an older review run when a new commit lands, preventing race conditions where a stale run's verdict overwrites a fresh one. **Recommended.**

### Why the `concurrency` block matters

Each review run creates one Jules session (billed against your 15-sessions/24h free quota) and owns a `jules/review` check run. Without a `concurrency` guard, two runs for the same PR can overlap: both spawn Jules sessions and both finalize the same-named check run, so the last one to finish wins — which may be the *older* verdict. GitHub's `concurrency` key is the only reliable mutual-exclusion for GitHub Actions jobs:

- `group: jules-review-${{ github.event.pull_request.number }}` — one review in flight per PR. Change the prefix (`jules-review-`) to make the group unique to this action if you also run other workflows on the same PR.
- `cancel-in-progress: true` — a new push cancels the in-flight review job so a stale run never overwrites a fresh verdict.
- `cancel-in-progress: false` — queued runs wait for the running one to finish. Safer for quota but slower: a burst of pushes can stack several full reviews.

Forks are skipped by default (`skip_forks: true`), and each run is also scoped to its head SHA via the check run, so two pushes to the *same* branch in quick succession are the main overlap case the `concurrency` block covers. If you prefer to keep the workflow file minimal, the check run name is configurable with `status_context` (default `jules/review`) so you can run this action under a different context alongside other tools.

### 3. (Optional) Gate merges on the review

`Settings → Branches → Branch protection rules → Require check runs to pass → jules/review`.

Without this, a blocking verdict shows as a failed check run but won't stop merge.

## Customizing the review

Three ways to shape what Jules looks for (most → least common):

### A. Inline rules in the workflow

Best for quick tweaks or project-level rules.

```yaml
- uses: thalesraymond/jules-pr-reviewer@v1
  with:
    jules_api_key: ${{ secrets.JULES_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    extra_instructions: |
      Project is a Flutter mobile app.

      Additional blocking rules:
      - Any setState() call inside build() is BLOCKING.
      - Any hardcoded API URL (not read from Config) is BLOCKING.
      - Missing await on a returned Future is BLOCKING.

      Soft rules:
      - Prefer const constructors where possible — raise as warning.
      - All public APIs must have dartdoc — raise as info.
```

### B. Rules file in the repo

Best when rules are long, evolving, or shared across workflows. Default path: `.github/jules-review-rules.md`.

```markdown
# Review rules for my-org/my-repo

## Always blocking

- Direct writes to `users.balance` without going through `account-service`.
- Any usage of `eval`, `Function(...)`, or `child_process.exec` with user input.

## Framework conventions

- React components must be functional (no class components).
- All API handlers must be wrapped in `withAuth()`.

## What to skip

- Tests are linted separately — don't review test files.
```

The action reads the file from the PR's base commit. Override the path with `rules_file:` or disable with `rules_file: ""`.

### C. Both

The workflow's `extra_instructions` is appended after the rules file content. Use the file for stable rules and the workflow for quick situational overrides.

## Inputs

| Input                | Default                         | Description                                                       |
| -------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `jules_api_key`      | —                               | **Required.** Key from jules.google.com.                          |
| `github_token`       | —                               | **Required.** `${{ secrets.GITHUB_TOKEN }}`.                      |
| `fail_on`            | `blocking`                      | `never` \| `blocking` \| `any`. Controls check run conclusion.  |
| `skip_drafts`        | `true`                          | Skip review on draft PRs.                                         |
| `skip_forks`         | `true`                          | Skip PRs from forks (diff can contain prompt-injection payloads). |
| `bypass_label`       | `jules-override`                | If the PR has this label, skip the review.                        |
| `status_context`     | `jules/review`                  | Check run name.                                                   |
| `extra_instructions` | `''`                            | Markdown appended to the prompt.                                  |
| `rules_file`         | `.github/jules-review-rules.md` | Path in repo to load as extra rules. Set empty to disable.        |
| `ignored_paths`      | `[]`                            | JSON array **or** comma/newline-separated list of paths/globs to exclude from diff (e.g. `["dist/**", "*.lock"]` or `dist/**, *.lock`). |
| `timeout_minutes`    | `30`                            | How long to wait for Jules to return a review.                    |
| `enable_suggestions` | `false`                         | Enable GitHub-native one-click suggested changes in review comments. |
| `dedupe`             | `true`                          | Don't re-report previously posted, still-open findings on subsequent reviews. Set to `false` to allow Jules to re-review and re-report prior findings. |
| `diff_mode`          | `prompt`                        | Review pipeline: `prompt` (embed the diff in the prompt) or `agentic` (Jules inspects the PR branch directly). |
| `large_pr_threshold` | `80000`                         | Diff size (characters) above which the large-PR strategy kicks in. |
| `large_pr_strategy`  | `prioritize`                    | How to handle diffs over `large_pr_threshold`: `prioritize` (review the highest-churn files that fit in the prompt budget and report which files were not covered) or `truncate` (keep the first N characters, legacy behaviour). |

## Outputs

The action emits the following outputs that can be consumed by downstream workflow steps:

| Output                | Type   | Description                                             |
| --------------------- | ------ | ------------------------------------------------------- |
| `verdict`             | string | Final review verdict: `approve`, `comment`, `block`, or `skipped`. |
| `issues_count`        | number | Total count of review issues found.                     |
| `high_issues_count`   | number | Count of high-severity issues.                          |
| `warning_issues_count` | number | Count of warning-level issues.                          |
| `info_issues_count`   | number | Count of info-level issues.                             |
| `session_id`          | string | Jules review session ID for reference and debugging.    |

### Example: Branch on verdict

```yaml
- uses: thalesraymond/jules-pr-reviewer@v1
  id: jules
  with:
    jules_api_key: ${{ secrets.JULES_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}

- name: Report results
  run: |
    echo "Verdict: ${{ steps.jules.outputs.verdict }}"
    echo "High issues: ${{ steps.jules.outputs.high_issues_count }}"
    echo "Session: ${{ steps.jules.outputs.session_id }}"

- name: Fail if blocking issues
  if: steps.jules.outputs.verdict == 'block'
  run: exit 1
```

### Enabling suggested changes

Opt-in to include GitHub-native one-click suggested changes in Jules' review comments. When enabled, Jules may propose exact code replacements that reviewers can apply with a single click from the PR interface.

```yaml
- uses: thalesraymond/jules-pr-reviewer@v1
  with:
    jules_api_key: ${{ secrets.JULES_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    enable_suggestions: true
```

> Suggestions are emitted only for `High` or `Medium` confidence comments. If GitHub rejects a suggestion (for example, because it falls outside a diff hunk), the action automatically retries without suggestions and falls back to the existing summary-only review as a last resort.

### Agentic diff mode

By default the action embeds the PR diff in the prompt. Diffs over `large_pr_threshold` (80,000 chars) are reviewed with the `prioritize` strategy: the highest-churn files that fit in the prompt budget are selected, and the review explicitly states which files were **not** covered. Set `diff_mode: agentic` to let Jules inspect the PR head branch directly instead — it runs `git diff <base>...<head>` itself, which removes the diff-size ceiling and gives it full repository context:

```yaml
- uses: thalesraymond/jules-pr-reviewer@v1
  with:
    jules_api_key: ${{ secrets.JULES_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    diff_mode: agentic
```

In agentic mode:

- Jules is instructed to fetch the diff with SHA-pinned `git diff` commands (with a branch-ref fallback) and is explicitly prohibited from modifying the repository.
- Ignored paths are passed to Jules as a hint merged with the repo's `.gitignore`, while the action-side filter stays active as defence-in-depth.
- Reviews of large PRs (diff over `large_pr_threshold`) include a coverage instruction to prioritize high-impact, high-confidence findings and to state how many of the changed files were actually reviewed.
- If the agentic session fails to start or times out, the action automatically falls back to the standard prompt-mode pipeline so the PR still gets exactly one review.
- The `changedFiles` list Jules reports is compared against the actual changed files; any mismatch is logged and surfaced as a warning, but it is never treated as a failure and does not trigger a fallback.
- Every Jules session created by the action is archived (best-effort) once the review is done.

## Severity, Confidence, & Verdict

Jules is instructed to return structured JSON data that parses each finding into its own PR review comment, complete with severity and confidence tags:

- **Severity**:
  - 🚨 **High**: High-confidence correctness/security flaws, data loss risks, broken auth, obvious bugs.
  - ⚠️ **Warning**: Meaningful concerns worth addressing but not blocking.
  - ℹ️ **Info**: Small readability or consistency notes. Used sparingly.

- **Confidence**:
  - 🟢 **High**
  - 🟡 **Medium**
  - 🔴 **Low**

Jules also generates a summary and a final verdict line:

| Verdict   | Meaning                           |
| --------- | --------------------------------- |
| `approve` | No blocking issues.               |
| `comment` | Warnings or infos only.           |
| `block`   | One or more high severity issues. |

`fail_on` maps verdict → check run conclusion:

| `fail_on`              | approve | comment     | block       |
| ---------------------- | ------- | ----------- | ----------- |
| `never`                | success | success     | success     |
| `blocking` _(default)_ | success | success     | **failure** |
| `any`                  | success | **failure** | **failure** |

The **workflow job itself always passes** if the action ran successfully — the check run is what gates merge. Job failures indicate the action broke, not that the review found issues.

## Inner Workings & Architecture

Behind the scenes, this action works by compiling a prompt combining the PR details, the incremental or full diff, your custom instructions, and a strict JSON schema requirement.

- **Incremental Diffing**: On `synchronize` events, the action only pulls the diff between the previous state and the new state, rather than fetching the entire PR diff. This prevents repeating comments on untouched code and speeds up the review process.
- **Auto-Resolving Threads**: The action fetches open PR review threads and includes them in the prompt. If Jules determines that a new commit fixes the issue raised in a comment, it signals the action to automatically mark the GitHub conversation thread as **resolved**.
- **Findings Deduplication**: When `dedupe` is on (default), the prompt also tells Jules not to re-report its own still-open findings as new comments — identical issues don't re-surface across pushes or runs. It can only re-report when the new diff introduces a materially different instance of a problem. Combined with incremental diffing, already-reviewed code stays quiet. Set `dedupe: false` if you want each push fully re-reviewed.
- **JSON Parsing**: By enforcing a strict JSON output from Jules, the action can decouple the language generation from the GitHub API calls, easily formatting individual line comments for `octokit.rest.pulls.createReview`.

## Prerequisites

Your repo must be connected to your Jules account. After authenticating at jules.google.com with GitHub, the repos you authorize become available as sources. To verify, create a file `list-sources.mjs`:

```js
import { jules } from "@google/jules-sdk";
for await (const s of jules.sources()) {
  if (s.type === "githubRepo") {
    console.log(`${s.githubRepo.owner}/${s.githubRepo.repo}`);
  }
}
```

Then run: `JULES_API_KEY=... node list-sources.mjs`

## Security

- **Only `pull_request` is supported.** `pull_request_target` is rejected — it runs with base-repo write tokens, and exposes the action to prompt-injection via attacker-controlled diffs.
- **Fork PRs are skipped by default** (`skip_forks: true`). An untrusted fork's diff/PR description can contain prompt-injection payloads.
- **`rules_file` is loaded from the base SHA**, not the PR head. An attacker cannot change the review rules by editing them in their PR.
- **All untrusted content is fenced** in the prompt as "UNTRUSTED" with explicit instructions to Jules.
- **Failure modes are resilient and actionable**: the action never leaves a stale `in_progress` check run. Every exit path either never creates the check run (config/event errors) or finalizes it with a `failure` conclusion (quota, auth, parse failure, timeout, crash). The failure summary on the check run names the root cause and tells you what to do about it.

## Rate limits & failure surface

The action classifies failures so you can tell what happened at a glance instead of reading raw stack traces:

| Failure kind | Detected by | What you see |
| ------------ | ----------- | ------------ |
| `config` | Invalid/missing inputs before the run starts | Job fails immediately; check run is not created. |
| `auth` | Jules `401`/`403` or GitHub "Resource not accessible" | Check run fails with a note to check `JULES_API_KEY` / `GITHUB_TOKEN` and workflow permissions. |
| `quota` | Jules `429` / quota / rate-limit wording | Check run fails with the session-cap message. |
| `parse` | Jules response that can't be parsed as a review | Block-verdict review is posted and the check run fails, noting the parse failure. |
| `timeout` | No review within `timeout_minutes` (2 attempts) | Check run fails suggesting a higher `timeout_minutes`. |
| `unknown` | Anything else | Check run fails with the root-cause message; details in the action log. |

Every failure also emits a structured `review_failed` log entry (`::structured::`) carrying `{ kind, stage, reason }`.

**Quota exhaustion.** Free Jules keys are capped at 15 sessions per 24 hours. When the cap is hit (HTTP 429 / quota message), the action fails fast with an explicit message instead of a cryptic error — including in agentic mode, where it skips the prompt-mode fallback because that session would fail the same way. To stay under the cap: use the `concurrency` block above, gate runs with `paths:` filters or the `bypass_label`, and skip drafts/forks.

**GitHub API rate limits.** GitHub calls — check-run create/update and thread resolution — retry transient failures (HTTP `5xx`, `429`, and rate-limit/abuse-detection responses) with exponential backoff, but fail fast on deterministic `401`/`403` auth errors instead of burning retries. The diff fetch falls back to the full PR diff if the incremental comparison fails.

## Notes

- **Latency**: typical review is 40s–5min.
- **Cost**: each PR open/push creates one Jules session. Rate-limit via `bypass_label`, label-gated workflow triggers, or `paths:` filters.
- **Drafts**: skipped by default; mark `ready_for_review` to trigger.
- **Large diffs**: diffs over `large_pr_threshold` (default 80,000 chars) are reviewed with the `prioritize` strategy — the highest-churn files that fit in the prompt budget are selected and the posted review states how many of the changed files were covered and which were not. Set `large_pr_strategy: truncate` to restore the legacy behaviour of silently keeping the first N characters.

## Agent Workflow (Spec-Driven + Cost Control)

For internal agent workflows, use a planner-led chain to reduce overhead:

1. Start from the planner agent.
2. Planner invokes a small code-explorer subagent for discovery.
3. Planner hands off to builder for execution.
4. Builder checks the feature spec in `docs/specs/` first, then implements code tasks.
5. Builder hands off to reviewer for pass/fail audit.
6. On fail, loop fixes through planner -> builder until pass.
7. After pass and verification checks, mark the spec work as complete.

Recommended invocation policy:

- Planner: user invocable.
- Reviewer: user invocable.
- Explorer: subagent only.
- Builder: subagent only.

This policy minimizes accidental high-cost runs and keeps execution aligned to approved scope.

## Development

This action uses `pnpm` for package management.

To install dependencies:

```bash
pnpm install
```

To build the action into the `dist` folder:

```bash
pnpm run build
```

## License

MIT