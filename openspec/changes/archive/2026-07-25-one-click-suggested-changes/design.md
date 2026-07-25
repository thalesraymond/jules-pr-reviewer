## Context

`jules-pr-reviewer` submits inline review comments via `octokit.rest.pulls.createReview()`. Each comment today has: `path`, `line`, `side`, and `body` (markdown text). The body includes severity/confidence headers, the review message, and an optional "Prompt for Agents" `<details>` block.

GitHub's review API accepts a ` ```suggestion ``` ` fenced block inside the comment body. When rendered in the PR interface, GitHub shows a one-click **"Apply suggestion"** button that commits the replacement inline. The API also accepts `start_line` for multi-line suggestions (both `start_line` and `line` must fall within a diff hunk, or the API returns 422).

The action already handles 422 with a `withFallback` strategy in `submitReview()` that degrades to summary-only. We extend that ladder to three tiers.

## Goals / Non-Goals

**Goals:**
- Let Jules emit optional one-click code suggestions alongside review comments.
- Make the feature opt-in via `enable_suggestions` action input.
- Implement a 3-tier graceful degradation on submission failure.
- Add prompt security guardrails to prevent attacker-controlled suggestion content.
- Validate suggestion data (line ordering, backtick escaping) before API submission.
- Label suggested fixes with a human-readable attribution note.

**Non-Goals:**
- Automatically applying suggestions (user always clicks).
- Suggestions for deleted lines (`LEFT` side); we only target the `RIGHT` (added/context) side.
- Validating that the suggestion compiles or is semantically correct — that's Jules' job.
- Supporting suggestions on lines outside the diff hunk (we degrade gracefully instead).

## Decisions

### D1: Opt-in via `action.yml` input, default `false`
**Why:** Teams who currently rely on the action should not see behaviour changes. Suggestion blocks require the LLM to produce higher-precision output; defaulting to off avoids surprising degraded reviews until a team consciously opts in.
**Alternatives considered:** Default `true` — rejected because it changes existing behaviour without consent. Environment variable — rejected in favour of the existing action input pattern.

### D2: `suggestion` stripped in `index.ts` when disabled, not in `github.ts`
**Why:** Keeps `submitReview()` unaware of the feature flag; it just formats whatever comments it receives. `index.ts` is the orchestration layer — it already owns input parsing and is the right place to gate features.
**Alternatives considered:** Pass the flag into `submitReview()` — rejected; increases coupling and makes the function harder to test in isolation.

### D3: Pre-submission validation in `github.ts` inside `submitReview()`
**Why:** Validation (guard `startLine > line`, escape backticks) is formatting logic, co-located with where the comment body is assembled. It's testable in isolation from the orchestrator.

### D4: 3-tier fallback ladder via nested `withFallback` calls
**Why:** Follows the existing `withFallback` utility pattern already used for Tier 3. Composing two `withFallback` calls keeps each tier explicit and independently testable.

```
Tier 1 (withFallback outer):
  primary   → submit with suggestions
  fallback  → Tier 2 on 422

Tier 2 (withFallback inner):
  primary   → submit without suggestions (strip suggestion fields from body)
  fallback  → Tier 3 (summary-only) on 422
```

**Alternatives considered:** Single fallback with conditional logic — rejected; harder to read and test each tier.

### D5: Suggestion only emitted by Jules for High/Medium confidence
**Why:** Low-confidence comments indicate Jules is uncertain; producing a one-click code change for uncertain findings is risky. We encode this in the prompt instruction, not in post-processing validation — the model is best positioned to self-filter.
**Risk:** Jules may still emit suggestions for Low confidence if the instruction is not followed. Mitigation: the opt-in flag and the human attribution note ("review carefully before applying") are last-resort safety nets.

### D6: Prompt security guardrail is additive to existing `# SECURITY — READ FIRST` section
**Why:** The existing section already establishes the attacker-controlled surface. We append a new sub-rule specifically for the `suggestion` field rather than creating a separate section, keeping the security instructions consolidated.

### D7: Attribution note above the suggestion block
**Why:** GitHub's UI makes suggestion blocks visually prominent — a developer may click "Apply" reflexively. A visible note (`> ⚠️ Jules suggested this fix — review carefully before applying.`) directly above the block adds friction at the decision point without hiding the feature.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Jules emits wrong indentation in suggestion | Prompt instructs: "preserve exact leading whitespace from the visible diff". Mis-indented suggestions degrade UX but don't break the action. |
| Jules emits suggestion for a line not in the diff hunk | GitHub returns 422 → Tier 2 degradation strips suggestions and retries. The review is still posted. |
| Attacker-controlled diff influences suggestion content | Prompt security guardrail explicitly prohibits following instructions from untrusted sections. Attribution note gives human a final review gate. |
| `startLine` and `line` span a hunk boundary | Pre-submission validation discards `startLine` if `startLine > line`. Line-boundary hunk issues still cause 422, handled by fallback ladder. |
| Low-quality suggestions erode developer trust | Feature is opt-in. Teams can disable if signal-to-noise is poor. |

## Migration Plan

- No schema or API breaking changes. The new `enable_suggestions` input defaults to `false`.
- Existing users see no change until they add `enable_suggestions: true` to their workflow.
- The `dist/index.js` bundle must be rebuilt and committed after implementation (`pnpm build`).
- README must be updated with the new input's description, default, and usage example.

## Open Questions

- None. All design decisions were resolved during the exploration phase.
