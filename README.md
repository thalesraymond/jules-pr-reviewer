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

Four ways to shape what Jules looks for (most → least common):

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

### C. Per-path rules directory

Best when different areas of the repo need different review standards (e.g. strict for `src/` auth code, relaxed for `docs/`). Default path: `.github/jules-rules`.

Every `.md` file in the directory is a per-path rule. The file's path relative to the directory **is the glob** (minus the trailing `.md`) — so globs containing `/` are expressed as real subdirectories:

```
.github/jules-rules/
├── src/**.md              → applies to files matching src/**
├── src/auth/**.md         → applies to files matching src/auth/**
├── docs/**.md             → applies to files matching docs/**
└── **.test.ts.md          → applies to files matching **.test.ts
```

Example `src/**.md`:

```markdown
## src/ rules

- Any usage of `eval` or `child_process.exec` with user input is BLOCKING.
- Every exported function must have a JSDoc type comment.
```

Example `docs/**.md`:

```markdown
## docs/ rules

- Only flag factual errors or broken links. Style nits in prose are out of scope.
```

The action reads the rules directory from the PR's base commit, matches each glob against the PR's changed files, and injects **only the rules that match at least one changed file** into the prompt — the prompt never bloats with rules for areas the PR doesn't touch. Override the path with `rules_directory:` or disable with `rules_directory: ""`. Missing or malformed rule files warn without failing the review.

### D. Both

The workflow's `extra_instructions` is appended after the rules file content. Global (`rules_file`) and per-path (`rules_directory`) rules are merged under one UNTRUSTED section, each per-path block labelled with its glob. Use files for stable rules and the workflow for quick situational overrides.

## Inputs

| Input                | Default                         | Description                                                       |
| -------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `jules_api_key`      | —                               | **Required.** Key from jules.google.com.                          |
| `github_token`       | —                               | **Required.** `${{ secrets.GITHUB_TOKEN }}`.                      |
| `fail_on`            | `blocking`                      | `never` \| `blocking` \| `any`. Controls check run conclusion.  |
| `min_severity_to_report` | `info`                      | Findings below this severity (`info` \| `warning` \| `high`) are not posted, annotated, or counted. |
| `block_on`           | unset                           | Severity at which a reported finding fails the check run (`high` \| `warning` \| `info`). Overrides `fail_on` when set. |
| `strictness`         | `chill`                         | Review strictness profile: `quiet` \| `chill` \| `assertive`. See [Strictness profiles](#strictness-profiles). |
| `skip_drafts`        | `true`                          | Skip review on draft PRs.                                         |
| `skip_forks`         | `true`                          | Skip PRs from forks (diff can contain prompt-injection payloads). |
| `bypass_label`       | `jules-override`                | If the PR has this label, skip the review.                        |
| `ignore_title_keywords` | `''`                         | List (JSON array or comma/newline-separated) of case-insensitive title substrings. If the title contains any, the review is skipped. |
| `ignore_authors`     | `''`                            | List of GitHub usernames whose PRs are skipped.                   |
| `review_labels`      | `''`                            | Allow/deny label filter; `-`-prefixed entries are deny labels. Only enforced when the event payload includes PR labels. |
| `status_context`     | `jules/review`                  | Check run name.                                                   |
| `extra_instructions` | `''`                            | Markdown appended to the prompt.                                  |
| `rules_file`         | `.github/jules-review-rules.md` | Path in repo to load as extra rules. Set empty to disable.        |
| `rules_directory`    | `.github/jules-rules`           | Directory in repo with per-path rule files; each `.md` file's path relative to the directory is a glob applied to the PR's changed files (e.g. `src/**.md` → `src/**`). Only matching rules are injected. Set empty to disable. |
| `ignored_paths`      | `[]`                            | JSON array **or** comma/newline-separated list of paths/globs to exclude from diff (e.g. `["dist/**", "*.lock"]` or `dist/**, *.lock`). |
| `timeout_minutes`    | `30`                            | How long to wait for Jules to return a review.                    |
| `enable_suggestions` | `false`                         | Enable GitHub-native one-click suggested changes in review comments. |
| `dedupe`             | `true`                          | Don't re-report previously posted, still-open findings on subsequent reviews. Set to `false` to allow Jules to re-review and re-report prior findings. |
| `diff_mode`          | `prompt`                        | Review pipeline: `prompt` (embed the diff in the prompt) or `agentic` (Jules inspects the PR branch directly). |
| `large_pr_threshold` | `80000`                         | Diff size (characters) above which the large-PR strategy kicks in. |
| `large_pr_strategy`  | `prioritize`                    | How to handle diffs over `large_pr_threshold`: `prioritize` (review the highest-churn files that fit in the prompt budget and report which files were not covered) or `truncate` (keep the first N characters, legacy behaviour). |

## Skipping & filtering reviews

Beyond `skip_drafts`, `skip_forks`, and `bypass_label`, five inputs control *whether* a review runs and *what* it reports. All of them are off by default — an unset input behaves exactly like the previous release.

### Skipping entire PRs

All three skip filters run before any API call, so skipped PRs never create a check run or a Jules session:

```yaml
- uses: thalesraymond/jules-pr-reviewer@v1
  with:
    jules_api_key: ${{ secrets.JULES_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    ignore_title_keywords: '["wip", "dependabot"]'   # or: "wip, dependabot"
    ignore_authors: "renovate[bot], octocat"
    review_labels: '["security", "-wip"]'
```

- **`ignore_title_keywords`** — list of **case-insensitive substrings**. If the PR title contains any of them (anywhere), the review is skipped. Note this is substring matching: `wip` also matches `swipe` or `WIP: ...`.
- **`ignore_authors`** — list of GitHub logins, matched case-insensitively against the PR author. `dependabot[bot]` is the login to use for Dependabot PRs.
- **`review_labels`** — allow/deny label policy in one input:
  - Plain entries are **allow** labels: the PR must have at least one of them to be reviewed.
  - Entries prefixed with `-` are **deny** labels: the PR must have none of them.
  - Mixing is supported: `["security", "-wip"]` means "review only security PRs that are not WIP".
  - Labels are matched case-insensitively.

### The `review_labels` limitation: labels are not guaranteed in `pull_request` payloads

The action only reads labels from the event payload — it never fetches them from the API. On `pull_request` events, GitHub does not reliably include PR labels in the payload. When the payload carries **no** label data, the filter cannot be evaluated, so the action logs a warning and **runs the review anyway** — it never fails (or silently skips) on un-evaluable label data, because a label-ordered workflow should not be able to kill all reviews. When the payload *does* include labels (even an empty list), the allow/deny policy is enforced exactly.

### Severity gating: report and block per severity

Two orthogonal knobs replace the all-or-nothing `fail_on` verdict mapping:

- **`min_severity_to_report`** (`info` default | `warning` | `high`) — findings below this level are dropped at the reporting boundary: no inline comment, no check-run annotation, no entry in `issues_count` / `high|warning|info_issues_count`. The LLM's prose summary is left untouched.
- **`block_on`** (`high` | `warning` | `info`, unset by default) — the check run fails when a **reported** finding is at or above this severity. When set, it overrides `fail_on`; when unset, the legacy `fail_on` verdict mapping applies unchanged.

"Block only on High, ignore Info" is then one line each:

```yaml
    min_severity_to_report: high
    block_on: high
```

Info and Warning findings never surface, and a `comment` verdict (which only ever reports Warning/Info findings) no longer fails the check.

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

Setting `block_on` replaces this verdict-based mapping with a finding-based one: the check run fails iff a *reported* finding is at or above the given severity (regardless of the verdict). This is the mechanism behind "block only on High, ignore Info" — see [Skipping & filtering reviews](#skipping--filtering-reviews). The `verdict` output always remains the LLM's verdict.

The **workflow job itself always passes** if the action ran successfully — the check run is what gates merge. Job failures indicate the action broke, not that the review found issues.

## Strictness profiles

A single `strictness` input dials how aggressively Jules hunts for issues and which findings surface on the PR:

| Level | Prompt behavior | What surfaces |
| ----- | --------------- | ------------- |
| `quiet` | Reviews conservatively: reports only findings it is confident about; when in doubt, leaves the comment out. | Only 🚨 **High** findings. Warnings and infos are filtered out deterministically before posting. |
| `chill` _(default)_ | Balanced hunting — identical instructions to previous versions of the action. | Everything Jules reports (High, Warning, Info). |
| `assertive` | Hunts aggressively: reports low-confidence suspicions (honestly tagged), and proactively surfaces style, naming, duplication, dead code, and readability issues. | Everything Jules reports (High, Warning, Info). |

```yaml
- uses: thalesraymond/jules-pr-reviewer@v1
  with:
    jules_api_key: ${{ secrets.JULES_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    strictness: quiet   # High-signal reviews for busy maintainers
```

Notes:

- The strictness instructions are trusted, action-authored prompt text — they cannot be overridden by content inside the PR diff, description, or rules file.
- `quiet` filters comments, check-run annotations, and the issue-count outputs (`issues_count`, `high_issues_count`, `warning_issues_count`, `info_issues_count`) to High findings, but the **verdict is unchanged** — the summary still reflects Jules's full judgment of the PR, and the check-run conclusion follows the verdict via `fail_on`. When `block_on` is set, the conclusion is computed from the reported (post-filter) findings instead, so the filters do shape the gate in that mode (see `block_on`).
- `chill` is the default and is byte-identical to the pre-strictness prompt, so upgrading changes nothing for existing users.

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
- **`rules_file` and `rules_directory` are loaded from the base SHA**, not the PR head. An attacker cannot change the review rules by editing them in their PR.
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
- **Cost**: each PR open/push creates one Jules session. Rate-limit via `bypass_label`, `ignore_title_keywords`, `ignore_authors`, `review_labels`, label-gated workflow triggers, or `paths:` filters.
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