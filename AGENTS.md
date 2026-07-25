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
├── github.ts      # GitHub API helpers (diff fetching, thread management, review submission)
├── jules.ts       # Jules SDK integration (session lifecycle, polling, response parsing)
├── prompt.ts      # Prompt builder for the review request
└── types.ts       # Shared type definitions (FailOn, Verdict, ReviewResult, etc.)

tests/
├── index.test.ts  # Tests for the action orchestrator
├── github.test.ts # Tests for GitHub API helpers
├── jules.test.ts  # Tests for Jules SDK integration
└── prompt.test.ts # Tests for prompt building
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

## Key Design Decisions

- **Prompt-injection defence:** The review prompt in [`prompt.ts`](./src/prompt.ts) explicitly labels PR title, description, diff, and rules file as `UNTRUSTED` to prevent the reviewed code from manipulating the LLM verdict.
- **`pull_request_target` is blocked:** The action refuses to run on `pull_request_target` to avoid token-scope escalation from fork PRs.
- **Incremental diffs:** On `synchronize` events the action diffs only the new commits (`payload.before → head.sha`) instead of the full PR diff.
- **Thread resolution:** The LLM can mark previous review comments as resolved by index, and the action resolves the corresponding GitHub review threads via GraphQL.
