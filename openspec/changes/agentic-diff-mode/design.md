# Design: Agentic Diff Mode

## Context

The action currently embeds the full PR diff as a fenced code block in the Jules prompt (`src/prompt.ts`). Jules receives a flat text blob with no structural awareness. This hits an 80 KB truncation limit and prevents Jules from exploring the repo autonomously.

A spike confirmed that Jules, when given `source: { baseBranch: <pr head> }`, can run `git diff <base>...HEAD` itself and return strict JSON matching the existing `ReviewResult` parse contract (session `9622646702095233241`).

The change adds a `diff_mode` input that selects between the existing prompt pipeline and a new agentic pipeline where Jules inspects the PR head branch directly.

## Goals / Non-Goals

**Goals:**
- Add `diff_mode` input (`prompt` | `agentic`, default `prompt`)
- Agentic prompt: SHA-based diff instruction with branch-ref fallback, read-only prohibition, merged ignored_paths, soft nudge for >50 files
- Fallback state machine: session-creation failure and timeout → prompt-mode fallback; verification mismatch (empty/partial) → fallback; extra-only → warn+proceed
- Session archiving: best-effort archive of every session the action creates
- `changedFiles: string[]` optional field in `ReviewResult`, logged but not enforced

**Non-Goals:**
- Cost ceilings / per-session budgets
- Auto-fixing the repo (read-only contract)
- Flipping default `diff_mode` to agentic
- Incremental agentic diffs (always full base...HEAD)
- Fork-PR support (stays skipped)
- Additional prototyping (spike evidence accepted)

## Decisions

### D1: Mode branching in `index.ts`, not a new entry point

**Why:** The agentic pipeline shares the same pre-amble (input parsing, skip checks, status setting) and post-amble (thread resolution, review submission, status mapping) as prompt mode. A branching point at the diff-fetch stage keeps the two pipelines DRY without duplicating orchestration.

**Alternatives considered:** Separate `runAgentic()` function — rejected; would duplicate 200+ lines of shared orchestration.

### D2: `source.baseBranch` set to `pr.head.ref` (not `pr.head.sha`)

**Why:** The SDK's `SourceInput.baseBranch` expects a branch name, not a SHA. The spike confirmed Jules can resolve `git diff <base>...HEAD` from a branch ref. SHAs are used in the diff instruction string for prompt-injection defense, not as SDK parameters.

**Alternatives considered:** Passing SHA as `baseBranch` — rejected; SDK validation may reject non-branch-name values.

### D3: Agentic prompt built as a separate function `buildAgenticPrompt`

**Why:** The agentic prompt has fundamentally different structure (no inline diff, SHA-based instructions, read-only security section). A separate function keeps `buildReviewPrompt` untouched and avoids mode-flag spaghetti in a single template.

**Alternatives considered:** Mode flag in `buildReviewPrompt` — rejected; would entangle two distinct prompt shapes in one function.

### D4: Fallback re-runs the full prompt pipeline inline

**Why:** On fallback, the action must produce exactly one review. Re-running the prompt pipeline (fetch diff → build prompt → run Jules → parse → submit) is the simplest path. The status is still `pending` at fallback time, so the prompt pipeline's final `setStatus` overwrites cleanly.

**Alternatives considered:** Pre-fetching both prompts — rejected; wasteful when agentic succeeds (the common case).

### D5: `changedFiles` verification uses existing `compareCommitsWithBasehead`

**Why:** The action already has the actual changed-file set from `fetchDiff` / GitHub API. Comparing Jules's `changedFiles` against this set requires no new API calls. The tiered policy (empty → fallback, partial → fallback, extra-only → warn) is computed in `index.ts` after parsing.

**Alternatives considered:** New API call to `pulls.listFiles` — rejected; redundant with data already available.

### D6: Archive is best-effort with try/catch

**Why:** The SDK has no cancel method; `archive()` only removes the session from the list view. A failed archive is cosmetic — it should never fail the review. try/catch + `logStructured` is sufficient.

**Alternatives considered:** Throwing on archive failure — rejected; would fail reviews for a non-critical operation.

## Architecture

```
index.ts
  ├─ [diff_mode === "prompt"] ──→ buildReviewPrompt() → runJulesReview() → ...
  └─ [diff_mode === "agentic"] ─→ buildAgenticPrompt() → runAgenticReview()
                                     │                          │
                                     │                    session.create()
                                     │                    pollForReview()
                                     │                    parseReviewResponse()
                                     │                          │
                                     │                    changedFiles verification
                                     │                          │
                                     │              ┌─── pass ──┤─── fail ──┐
                                     │              │           │           │
                                     │              ▼           ▼           ▼
                                     │          submit      fallback    fallback
                                     │          review      (prompt)    (prompt)
                                     │              │           │           │
                                     │              ▼           ▼           ▼
                                     │          archive     archive     archive
                                     │          session     agentic     prompt
                                     │                      session     session
```

## Files Modified

| File | Change |
|------|--------|
| `action.yml` | Add `diff_mode` input |
| `src/types.ts` | Add `DiffMode` type, `changedFiles` to `ReviewResult`, `AgenticPromptArgs` interface |
| `src/prompt.ts` | Add `buildAgenticPrompt()` function |
| `src/jules.ts` | Add `runAgenticReview()` with fallback + archive; refactor `archiveSession()` helper |
| `src/index.ts` | Add mode branching, changedFiles verification, file-count nudge logic |
| `src/validation.ts` | Add `changedFiles` parsing in `strictValidateReviewResult` |
| `src/logging.ts` | Add `agentic_fallback` and `verification_mismatch` to `StructuredLogEvent` |

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Agentic mode adds latency (Jules must clone + diff) | Prompt mode unchanged as default; agentic is opt-in |
| Abandoned agentic sessions consume Jules resources | Best-effort archive + read-only prohibition limits blast radius |
| `changedFiles` may be incomplete (LLM hallucination) | Tiered verification; empty/partial triggers fallback; extra-only warns |
| Prompt injection via agentic diff instructions | UNTRUSTED labels on all user-controllable sections; SHA-based instructions |

## Migration Plan

- No breaking changes — `diff_mode` defaults to `prompt`
- No action.yml output changes
- `dist/index.js` must be rebuilt (`pnpm build`)
- README updated with new `diff_mode` input documentation

## Open Questions

None. All design decisions were resolved in the wayfinder tickets ([Agentic prompt contract](https://github.com/thalesraymond/jules-pr-reviewer/issues/104), [Agentic fallback triggers and session lifecycle](https://github.com/thalesraymond/jules-pr-reviewer/issues/105)).
