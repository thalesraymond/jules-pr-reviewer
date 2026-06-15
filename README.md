# Jules PR Reviewer

A GitHub Action that uses [Google Jules](https://jules.google) (Gemini-powered cloud coding agent) to review pull requests and post the review as a PR comment. Optionally gates merges via a commit status check.

_Special thanks to [@sanjay3290](https://github.com/sanjay3290) for the original work in the base action_

- Works on any language / framework — Jules is general-purpose.
- Low noise by default: aggressive false-positive filter baked into the prompt.
- Extensible: layer your own rules from the workflow or from a file in the repo.
- **Line-level Comments**: Posts findings directly on the specific lines of code in the PR.
- **Auto-resolves threads**: Automatically resolves its own comments if you fix the issue and push a new commit.
- **Incremental reviews**: Only reviews the new changes between pushes (on `synchronize` events) to save time and tokens.

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
      statuses: write
    steps:
      - uses: thalesraymond/jules-pr-reviewer@v1
        with:
          jules_api_key: ${{ secrets.JULES_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

The `concurrency` block cancels an older review run when a new commit lands, preventing race conditions where a stale run's verdict overwrites a fresh one. **Recommended.**

### 3. (Optional) Gate merges on the review

`Settings → Branches → Branch protection rules → Require status check → jules/review`.

Without this, a blocking verdict shows as a red X but won't stop merge.

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
| `fail_on`            | `blocking`                      | `never` \| `blocking` \| `any`. Controls commit-status state.     |
| `skip_drafts`        | `true`                          | Skip review on draft PRs.                                         |
| `skip_forks`         | `true`                          | Skip PRs from forks (diff can contain prompt-injection payloads). |
| `bypass_label`       | `jules-override`                | If the PR has this label, skip the review.                        |
| `status_context`     | `jules/review`                  | Commit status context name.                                       |
| `extra_instructions` | `''`                            | Markdown appended to the prompt.                                  |
| `rules_file`         | `.github/jules-review-rules.md` | Path in repo to load as extra rules. Set empty to disable.        |
| `timeout_minutes`    | `30`                            | How long to wait for Jules to return a review.                    |

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

`fail_on` maps verdict → status:

| `fail_on`              | approve | comment     | block       |
| ---------------------- | ------- | ----------- | ----------- |
| `never`                | success | success     | success     |
| `blocking` _(default)_ | success | success     | **failure** |
| `any`                  | success | **failure** | **failure** |

The **workflow job itself always passes** if the action ran successfully — the status check is what gates merge. Job failures indicate the action broke, not that the review found issues.

## Inner Workings & Architecture

Behind the scenes, this action works by compiling a prompt combining the PR details, the incremental or full diff, your custom instructions, and a strict JSON schema requirement.

- **Incremental Diffing**: On `synchronize` events, the action only pulls the diff between the previous state and the new state, rather than fetching the entire PR diff. This prevents repeating comments on untouched code and speeds up the review process.
- **Auto-Resolving Threads**: The action fetches open PR review threads and includes them in the prompt. If Jules determines that a new commit fixes the issue raised in a comment, it signals the action to automatically mark the GitHub conversation thread as **resolved**.
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
- **Failure modes are resilient**: if Jules times out, the API errors, or the action crashes, the commit status is set to `error` and the PR comment is updated with a failure note — merge isn't silently blocked by a stale `pending` check.

## Notes

- **Latency**: typical review is 40s–5min.
- **Cost**: each PR open/push creates one Jules session. Rate-limit via `bypass_label`, label-gated workflow triggers, or `paths:` filters.
- **Drafts**: skipped by default; mark `ready_for_review` to trigger.
- **Large diffs**: diff is truncated at 80 KB. When truncated, the prompt tells Jules its review may be incomplete.

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


