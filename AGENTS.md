# Agent Guidelines

When working on this project, AI agents should adhere to the following core principles and rules:

- **Test-Driven Development (TDD):** Use TDD to develop new features. Write your tests first, and then write the minimum code necessary to pass those tests.
- **Strict Type Safety:** Avoid using `any`, `as any`, or `as unknown` to bypass TypeScript type safety. Ensure the codebase remains strictly typed.
- **Continuous Verification:** Always run tests, build, lint, and prettier scripts to verify that your changes are not breaking anything before completing a task or committing.
- **Commit Conventions:** Use [Conventional Commits](https://www.conventionalcommits.org/). Try to keep your changes segregated into small, atomic commits that address a single concern.
- **Architecture & Design:** Follow SOLID principles whenever possible to keep the code clean, modular, and easy to maintain.
- **Documentation Upkeep:** Always check [`README.md`](./README.md). If your changes introduce new features, alter setup steps, or otherwise demand an update in the project documentation, make sure to update the README accordingly.

## Project Overview

This is a **GitHub Action** (`jules-pr-reviewer`) that uses the [Google Jules SDK](https://www.npmjs.com/package/@google/jules-sdk) to automatically review pull requests and post review comments. It runs on `pull_request` events and is configured via [`action.yml`](./action.yml).

## Tech Stack

| Layer        | Tool                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| Runtime      | Node 24 (GitHub Actions runner)                                            |
| Language     | TypeScript 6 (`strict: true`, ES2022 target, ESNext modules)              |
| Package Mgr  | pnpm                                                                       |
| Bundler      | `@vercel/ncc` — single-file output to `dist/index.js`                     |
| Test Runner  | Vitest 4 (with `@vitest/coverage-v8`)                                      |
| Linter       | ESLint 10 + `typescript-eslint` + `eslint-config-prettier`                 |
| Formatter    | Prettier 3                                                                 |
| Git Hooks    | Husky 9 (`pre-commit` runs lint → format:check → build → coverage)        |
| Commit Lint  | commitlint + `@commitlint/config-conventional`                             |
| CI           | GitHub Actions (see [`.github/workflows/`](./.github/workflows/))          |

## Project Structure

```
src/
├── index.ts       # Action entry point — input parsing, orchestration, status reporting
├── github.ts      # GitHub API helpers (diff fetching, thread management, status)
├── submission.ts  # Review submission pipeline (formatting, sanitization, fallback ladder)
├── jules.ts       # Review mode wrappers (prompt-mode retry, agentic-mode fallback)
├── session.ts     # Jules session lifecycle (create, readiness, polling, response parsing, archive)
├── prompt.ts      # Prompt builder for the review request
└── types.ts       # Shared type definitions (FailOn, Verdict, ReviewResult, etc.)

tests/
├── index.test.ts      # Tests for the action orchestrator
├── github.test.ts     # Tests for GitHub API helpers
├── submission.test.ts # Tests for review submission pipeline
├── jules.test.ts      # Tests for review mode wrappers
├── session.test.ts    # Tests for the Jules session lifecycle
└── prompt.test.ts     # Tests for prompt building
```

## Verification Commands

Run all of these before considering your work done:

```bash
pnpm lint          # ESLint — must pass with zero errors
pnpm format:check  # Prettier — must report no formatting issues
pnpm build         # ncc bundle — must compile without errors
pnpm test          # Vitest — all tests must pass
pnpm coverage      # Vitest + v8 — must meet 90% thresholds (lines, functions, branches, statements)
```

> **Note:** The Husky `pre-commit` hook runs `lint → format:check → build → coverage` automatically.
> The `commit-msg` hook runs commitlint to enforce conventional commit messages.

## Testing Conventions

- **Framework:** Vitest with `describe` / `it` / `expect`.
- **Location:** Place test files in `tests/` with the pattern `<module>.test.ts`, mirroring the source file they test.
- **Mocking:** Use `vi.fn()` and `vi.spyOn()` for mocking. Create inline mock objects that satisfy the needed interface shape.
- **Coverage Thresholds:** 90 % across lines, functions, branches, and statements. These are enforced in [`vitest.config.ts`](./vitest.config.ts) and will fail the build if not met.

## Code Style

- **Quotes:** Double quotes (enforced by both ESLint and Prettier).
- **Semicolons:** Always.
- **Trailing commas:** ES5-style.
- **Print width:** 80 characters.
- **Indent:** 2 spaces.
- **Imports:** Use `.js` extensions for local imports (required by ESM + bundler module resolution).

## Committing Changes

- Write messages using the [Conventional Commits](https://www.conventionalcommits.org/) format (e.g. `feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`).
- Keep commits small and atomic — one logical change per commit.
- The `dist/` folder is checked in. The pre-commit hook auto-rebuilds and stages it, but verify the bundle is up-to-date if you bypass hooks.

## Multi-Agent Configuration

This project defines specialized agent roles under [`.github/agents/`](./.github/agents/). While these files are consumed by GitHub Copilot agent mode, every agent working on the repository should be aware of them and respect the split responsibilities when coordinating work.

| File | Agent | Purpose |
| ---- | ----- | ------- |
| [`.github/agents/builder.agent.md`](./.github/agents/builder.agent.md) | `code-builder` | Executes approved plans, edits files, runs verification commands, and hands off to `code-reviewer`. |
| [`.github/agents/codebase-explorer.agent.md`](./.github/agents/codebase-explorer.agent.md) | `codebase-explorer` | Read-only discovery agent that summarizes target files, dependencies, and constraints for planners. |
| [`.github/agents/planner.agent.md`](./.github/agents/planner.agent.md) | `spec-planner` | Produces bounded implementation plans, starts with explorer handoff, and routes execution to `code-builder`. |
| [`.github/agents/reviewer.agent.md`](./.github/agents/reviewer.agent.md) | `code-reviewer` | Audits uncommitted diffs, runs verification, and routes failures back to `spec-planner` or archive on pass. |

### Handoff Workflow

1. `spec-planner` begins with the `codebase-explorer` handoff to gather context.
2. `spec-planner` produces a plan and hands it to `code-builder` for implementation.
3. `code-builder` applies changes and performs verification, then hands off to `code-reviewer`.
4. `code-reviewer` either returns findings to `spec-planner` for a fix plan, or triggers the archive handoff on success.

Agents that do not natively consume these definitions should still mirror this separation of concerns: read before planning, plan before editing, verify before reviewing, and review before archiving.

## Key Design Decisions

- **Prompt-injection defence:** The review prompt in [`prompt.ts`](./src/prompt.ts) explicitly labels PR title, description, diff, and rules file as `UNTRUSTED` to prevent the reviewed code from manipulating the LLM verdict.
- **`pull_request_target` is blocked:** The action refuses to run on `pull_request_target` to avoid token-scope escalation from fork PRs.
- **Incremental diffs:** On `synchronize` events the action diffs only the new commits (`payload.before → head.sha`) instead of the full PR diff.
- **Thread resolution:** The LLM can mark previous review comments as resolved by index, and the action resolves the corresponding GitHub review threads via GraphQL.

## Agent skills

### Issue tracker

Issues live as GitHub issues on `thalesraymond/jules-pr-reviewer`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles map to: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at repo root + `docs/adr/`. Feature specs live in `docs/specs/` (to-spec model). See `docs/agents/domain.md`.
