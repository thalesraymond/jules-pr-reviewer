# ADR-018: Per-path review instructions

## Status
Accepted

## Date
2026-08-16

## Context
Review instructions were limited to a single global `rules_file` applied to the whole diff. Repos with heterogeneous areas (strict auth code, relaxed docs, generated bundles) cannot express "apply these rules only to these paths" — CodeRabbit supports glob-scoped `path_instructions` and Copilot supports per-directory instruction files. Over-applying strict rules globally causes false positives; under-applying misses findings in critical areas.

## Decision
Add a `rules_directory` input (default `.github/jules-rules`, set empty to disable) whose contents are per-path rule files loaded from the PR's **base SHA**:

1. **The rule file's path is the glob.** Every `.md` file under the directory is a per-path rule; its path relative to the directory (minus the trailing `.md`) is the glob, so globs containing `/` are expressed as real subdirectories (`.github/jules-rules/src/**.md` → `src/**`). No manifest to keep in sync.
2. **Discovery is a recursive `getContent` walk at the base SHA**, confined to the rules directory — same API family and `ref` semantics as the existing `loadRulesFromBase` (ADR-003), no whole-repo trees fetch, no SHA resolution.
3. **Selection happens before fetching.** Only rule files whose glob matches at least one changed file of the PR are loaded — irrelevant rules never bloat the prompt; zero content fetches happen when nothing matches.
4. **Merging.** Global `rules_file` + matching per-path rules render under the single existing `# UNTRUSTED: Project-specific rules` header, one `## Per-path rules — files matching \`<glob>\`` block per rule. Prompt-injection defence (ADR-003) is unchanged: all rule content is UNTRUSTED-fenced, and per-path files are read at the base SHA so a PR cannot modify them.
5. **Warn-don't-crash validation.** Missing directory, unreadable file, or malformed glob (unbalanced brackets/braces, since minimatch never throws) emits a `core.warning` and is skipped. Non-`.md` files are ignored silently.

## Alternatives Considered

### Manifest file mapping globs to instructions
- Pros: Globs independent of filename encoding
- Cons: Second artifact to keep in sync, its own parsing/validation surface
- Rejected: Filename-encoded globs need no manifest and keep discovery to a bounded listing

### Full-repo trees API discovery
- Pros: One call, no recursion
- Cons: Returns the whole repo subtree (potentially huge on monorepos), needs commit→tree SHA resolution
- Rejected: A recursive walk confined to the rules directory is bounded and reuses the existing `getContent`-at-base-SHA path

## Consequences
- Existing configurations are unchanged: `rules_file` behaviour is identical; `rules_directory` is additive and off by default.
- Per-path rules can never break the pipeline: every failure mode warns and degrades to the global-rules-only review.
- The prompt grows only by rules relevant to the PR's changed files.
- `**.test.ts`-style globs (globstar followed by a suffix) are normalized to `**/*.test.ts` at match time so they match nested paths, matching the documented semantics.
