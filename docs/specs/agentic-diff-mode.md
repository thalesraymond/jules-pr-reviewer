# Spec: Agentic Diff Mode

## Problem Statement

PR authors and maintainers rely on `jules-pr-reviewer` to catch issues, but the default prompt-mode pipeline embeds the entire PR diff as a fenced code block in the Jules prompt. This hits a hard 80 KB truncation limit on large PRs, and Jules sees a flat text blob with no structural awareness of the repository. Large PRs get truncated, incomplete reviews, and Jules cannot explore the repo to answer questions that require cross-file context.

## Solution

Add a `diff_mode` input (`prompt` | `agentic`, default `prompt`). In agentic mode Jules inspects the PR head branch directly — running `git diff <base_sha>...<head_sha>` itself — giving it full repository context and removing the diff-size ceiling. Agentic mode gets its own prompt contract (SHA-based diff instructions, read-only prohibition, merged ignored paths, a soft nudge for very large PRs), a fallback state machine back to prompt mode on session-creation failure or timeout, informational verification of the files Jules reports reviewing, and best-effort archiving of every session the action creates.

## User Stories

1. As a PR author, I want the reviewer to handle large PRs without truncating the diff, so that my large PRs get a complete review.
2. As a PR author, I want Jules to be able to inspect the repository structure, so that reviews can take cross-file context into account.
3. As an action maintainer, I want a `diff_mode` input that defaults to `prompt`, so that existing users see no behaviour change unless they opt in.
4. As a PR author, I want agentic mode to give Jules SHA-based diff instructions with a branch-ref fallback, so that the diff can be resolved even when SHAs cannot be reached.
5. As a PR author, I want agentic mode to prohibit Jules from modifying, creating, or deleting files, so that a read-only review is guaranteed.
6. As a PR author, I want my `ignored_paths` to be honored in agentic mode, so that the same paths I filter in prompt mode stay out of agentic reviews.
7. As a PR author, I want very large PRs (more than 50 files) to receive a soft nudge to prioritize high-impact findings, so that the most important issues are surfaced first.
8. As a maintainer, I want agentic mode to keep prompt-injection defenses, labeling all user-controllable content as UNTRUSTED, so that attacker-controlled diffs and descriptions cannot manipulate the verdict.
9. As a maintainer, I want the action to fall back to prompt mode when the agentic session cannot be created, so that a review still happens when the head branch is deleted, a branch name is rejected, or Jules is degraded.
10. As a maintainer, I want the action to fall back to prompt mode when the agentic session times out, so that the PR is never left without a review.
11. As a maintainer, I want the prompt-mode fallback to use the full `timeoutMinutes` budget, so that the fallback is not unfairly truncated.
12. As a maintainer, I want exactly one review posted to the PR even when a fallback happens, so that the PR does not get duplicate reviews.
13. As a maintainer, I want the abandoned agentic session archived best-effort on fallback, so that the user's Jules session list stays clean.
14. As a maintainer, I want every Jules session the action creates to be archived best-effort, so that abandoned sessions do not pile up.
15. As a maintainer, I want a failed archive to never fail the review, so that a cosmetic cleanup failure does not lose a review.
16. As a maintainer, I want Jules to be able to report the list of files it reviewed via an optional `changedFiles` field, so that review coverage can be logged.
17. As a maintainer, I want `changedFiles` mismatches (empty, partial, extra-only) to be logged as informational verification events, so that users are informed without losing the review.
18. As a maintainer, I want a `changedFiles` mismatch to never trigger a fallback or retry, so that an incomplete file report does not discard a valid agentic review.
19. As a maintainer, I want a clear error message when `diff_mode` is set to an invalid value, so that misconfigurations fail fast.
20. As a PR author, I want agentic mode to drop the 80 KB diff truncation, so that no hard cap applies to reviews.

## Implementation Decisions

### Mode branching in the orchestrator

The two pipelines share the same pre-amble (input parsing, skip checks, status setting) and post-amble (thread resolution, review submission, status mapping). The branching point is at the diff-fetch stage in the orchestrator, keeping the two pipelines DRY without a separate entry point.

### `source.baseBranch` set to the PR head ref

The Jules SDK's `SourceInput.baseBranch` expects a branch name, not a SHA. The head branch ref is passed as the SDK parameter; SHAs are used only in the diff instruction string, which is a prompt-injection defense measure.

### Separate agentic prompt builder

A distinct agentic prompt builder keeps the existing prompt-mode builder untouched. The agentic prompt has a fundamentally different shape: SHA-based diff instructions, a read-only SECURITY section, merged `ignored_paths`, a >50-file nudge, and UNTRUSTED labels on PR title, description, diff instructions, rules file, and ignored paths.

### Fallback re-runs the full prompt pipeline inline

On fallback the action re-runs fetch diff → build prompt → run Jules → parse → submit. The status is still `pending` at fallback time, so the prompt pipeline's final status write overwrites cleanly, and exactly one review is produced.

### `changedFiles` verification is log-only

The action already holds the actual changed-file set, so verification needs no new API calls. Any difference between Jules's `changedFiles` and the real set — empty, partial, or extra-only — is logged as a `verification_mismatch` structured event with `{ tier, reportedCount, actualCount }` and never triggers a fallback or retry.

### Best-effort archiving with try/catch

Archiving removes the session from the Jules list view; a failure is cosmetic and must not fail the review. Every agentic or prompt-fallback session is archived in a try/catch, with archive failures logged via the structured logger.

## Testing Decisions

- **What makes a good test:** Test the external contract — the prompt text the mode produces, the fallback triggers and their side effects (one review posted, session archived), and the `verification_mismatch` logging — not the internal branching mechanics.
- **Modules under test:**
  - `prompt.ts` — agentic prompt contract (SHA-based diff instruction, read-only prohibition, ignored paths merging, >50-file nudge, UNTRUSTED labels).
  - `jules.ts` — `runAgenticReview` fallback state machine (session-creation failure and timeout fall back; no agentic retry), session archiving, and the log events emitted.
  - `index.ts` — `diff_mode` input parsing, mode branching, invalid-value failure, and `changedFiles` verification logging.
  - `validation.ts` — optional `changedFiles` field parsing in `parseReviewResponse`.
- **Prior art:** `tests/jules.test.ts` already mocks `runSession` and asserts review outcomes; `tests/index.test.ts` mocks the github/jules/submission helpers and asserts orchestrator behavior; `tests/prompt.test.ts` asserts prompt text content for prompt mode. The new tests follow these patterns (mock external boundaries with `vi.fn()`/`vi.spyOn()`, assert on structured log events and prompt content).

## Out of Scope

- Cost ceilings or per-session budgets for agentic mode.
- Auto-fixing the repository (the agentic contract is strictly read-only).
- Flipping the default `diff_mode` to `agentic`.
- Incremental agentic diffs — agentic mode always uses the full `base...head` range.
- Fork-PR support — forks stay skipped in both modes.
- Enforcing completeness of `changedFiles` — it is informational only.

## Further Notes

- The design was validated by a spike confirming Jules can resolve `git diff <base>...HEAD` from a head-branch source and return strict JSON matching the existing `ReviewResult` parse contract.
- Prompt injection is defended with UNTRUSTED labels and SHA-based diff instructions; the read-only prohibition limits blast radius.
- See ADR-013 for the GitHub Checks API status reporting that the two pipelines share.
