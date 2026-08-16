# Spec: Per-path review instructions

## Problem Statement

Today there is exactly one global `rules_file` (default `.github/jules-review-rules.md`) applied to the whole diff. A monorepo or a repo with heterogeneous areas (strict auth code, relaxed docs, lockstep-generated bundles) cannot express "apply these rules only to these paths". CodeRabbit supports glob-scoped `path_instructions`; Copilot supports per-directory `*.instructions.md` files. We support neither, so repos must either over-apply strict rules globally (false positives in relaxed areas) or under-apply them (missed findings in critical areas). This is the highest-leverage control feature that remains missing.

## Solution

Add a `rules_directory` input (default `.github/jules-rules`, set empty to disable) whose contents are per-path rule files loaded from the PR's **base SHA**:

- Every `.md` file inside the directory is a per-path rule. The file's path relative to the directory **is** the glob (minus the trailing `.md`), so globs that contain `/` need no encoding — they are real subdirectories. Examples:

  | Rule file                        | Glob          | Applies to                      |
  | -------------------------------- | ------------- | ------------------------------- |
  | `.github/jules-rules/src/**.md`  | `src/**`      | anything under `src/`           |
  | `.github/jules-rules/docs/**.md` | `docs/**`     | anything under `docs/`          |
  | `.github/jules-rules/**.md`      | `**`          | every changed file              |
  | `.github/jules-rules/**.test.ts.md` | `**.test.ts` | any `*.test.ts` anywhere      |

- Discovery walks the directory with the content API at the base SHA (recursive only inside the rules directory), so arbitrary globs (including `**`) work without hand-rolling a full-repo walk.
- Only rule files whose glob matches **at least one changed file of this PR** are loaded — irrelevant rules never bloat the prompt. Content is fetched with the existing `getContent`-at-base-SHA path used for `rules_file`.
- The prompt merges global rules (`rules_file`) and all matching per-path rules into the existing **`# UNTRUSTED: Project-specific rules`** section, each per-path block labelled with its glob. The prompt-injection defence (ADR-003) is unchanged: rule content is attacker-visible data at worst (it lives at the base SHA, which an attacker cannot modify), but it is still fenced as UNTRUSTED exactly like the global rules.
- Validation is warn-don't-crash: a missing directory (default path), an unreadable file, or a malformed glob emits a `core.warning` and is skipped.

## User Stories

1. As a maintainer, I want strict rules applied only to `src/` auth code and relaxed rules applied only to `docs/`, so that both areas are reviewed with appropriately calibrated standards.
2. As a maintainer, I want global rules and per-path rules merged into one review, so that existing `rules_file` users keep their behaviour unchanged (backward compatible).
3. As a maintainer, I want per-path rules loaded from the base SHA, so that an attacker cannot inject instructions by editing a rule file inside their PR.
4. As a maintainer, I want only rules matching changed files included, so that the prompt does not grow with rules for areas the PR never touches.
5. As a maintainer, I want a misconfigured directory (missing files, bad globs) to warn without failing the review, so that a typo never blocks CI.
6. As a maintainer, I want the exact glob of each applied rule visible in the prompt, so that Jules knows which files each instruction block applies to.

## Implementation Decisions

### Glob-encoded filenames: the file's path under the directory IS the glob

The issue leaves the mechanism open ("rules/*.md with path globs, or a directory keyed by path"). A manifest file (glob → instructions) adds a second artifact to keep in sync and needs its own parsing/validation. Filename-encoded globs need no manifest: the tree at the base SHA already lists every rule file, the glob is derivable by stripping the trailing `.md`, and `/` inside globs is expressed naturally as real subdirectories. This matches the "`rules/*.md` with path globs" option in the issue and keeps discovery to a recursive walk confined to the directory.

### Discovery via `getContent` directory listing, confined to the rules directory

The trees API returns the whole repo subtree (potentially huge on monorepos) and needs a tree SHA resolved from the commit SHA. A recursive walk of `getContent` directory listings stays inside the rules directory (tiny payloads), reuses the same API family and `ref: baseSha` semantics as the existing `loadRulesFromBase` (ADR-003 base-SHA guarantee), and needs no SHA resolution. The walk is bounded by the rules directory's own (shallow) structure. A missing directory 404s and warns once — mirroring the existing behaviour when the default `rules_file` is absent.

### Selection happens before fetching

Matching rule files to changed files first, then fetching only the matched subset, keeps API calls proportional to relevant rules. On the common case (no rule file matches) zero content fetches happen beyond the two discovery calls.

### Warn-don't-crash validation

- Directory missing at base SHA: the `getContent` listing 404s; warn once and treat as empty (mirrors the existing warning when the default `rules_file` is absent).
- Unreadable rule file: existing `loadRulesFromBase` already warns and returns `undefined`; the entry is skipped.
- Malformed glob: minimatch v10 never throws (it silently matches nothing), so well-formedness is checked explicitly — unbalanced `[`/`]` or `{`/`}` — and the offending rule is skipped with a `core.warning` naming the file.
- Non-`.md` files in the directory are not rules and are ignored silently.

### Per-path blocks live inside the existing UNTRUSTED rules section

The merged output keeps the single `# UNTRUSTED: Project-specific rules` header (the existing prompt test contract), followed by the global content, then one `## Per-path rules — files matching \`<glob>\`` block per matched rule. The glob label is trusted (derived from the base tree); the content is UNTRUSTED data. No new trusted instructions are added, so the security model is unchanged.

### New domain module `src/pathRules.ts`

Following the ADR-010/011 domain-module split: pure helpers (glob derivation, well-formedness check, candidate parsing, matching) plus one orchestration function `loadPerPathRules(octokit, owner, repo, rulesDir, baseSha, changedFiles)` that composes the GitHub calls (trees listing + content loads) and returns typed `PathRuleFile[]`. The GitHub API primitives (`listFilesInDirectory`) live in `github.ts`; the shared `PathRuleFile` type lives in `types.ts`.

## Testing Decisions

- **What makes a good test:** All logic is unit-testable without a Jules session: glob derivation and well-formedness, candidate parsing/sorting, glob-vs-changed-files matching, warn paths (API failure, unreadable content, malformed glob), the merged prompt rendering, config parsing, and the index wiring (discovery called with base SHA + changed files, per-path rules forwarded into the prompt in both modes).
- **Modules under test:**
  - `pathRules.ts` — `globFromRulePath`, `isRuleFile`, `parseRuleCandidates` (sorting/filtering), `selectMatchingRules` (match/drop/warn-malformed), `loadPerPathRules` (happy path, unreadable skip, empty directory).
  - `github.ts` — `listFilesInDirectory` (recursive listing, file-vs-dir handling, warn-and-empty on API error or non-directory path).
  - `prompt.ts` — merged UNTRUSTED section with global + per-path blocks, per-path-only, absent when neither present.
  - `config.ts` — `rules_directory` default, empty-string disable, custom value.
  - `index.ts` — per-path discovery invoked with `(octokit, owner, repo, rulesDirectory, baseSHA, changedFiles)`, per-path content visible in the prompt handed to Jules.
- **Prior art:** existing `github.test.ts` mocks `@actions/core` and inline octokit shapes; `index.test.ts` mocks sub-modules via `vi.doMock`. Both patterns are reused.

## Out of Scope

- Manifest-file based rule mapping (filename globs chosen instead).
- Per-path rule files on the PR head SHA (always base — that is the point of the defence).
- Rules that change the verdict policy or output format per path (instructions only, like `rules_file`).
- Wildcard support beyond minimatch patterns (e.g. regex paths).

## Further Notes

- `rules_file` behaviour is unchanged; `rules_directory` is additive and disabled by setting it to an empty string.
- Security model unchanged: all rule content (global and per-path) is UNTRUSTED-fenced (ADR-003); per-path files are read at the base SHA, so a PR cannot modify them.
- The directory walk costs one `getContent` call per directory level of the rules directory (missing directory: one 404-warning). This is bounded and cheap relative to the existing API surface (diff fetch, threads, check run).
