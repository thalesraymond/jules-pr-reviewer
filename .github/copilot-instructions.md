# Repository Instructions for GitHub Copilot

Use these persistent rules for every session in `jules-pr-reviewer`. Do not repeat them in the prompt body.

## First Source of Truth

For full project policy, agent roles, verification commands, code style, and file map, read `AGENTS.md` first.

## Required Verification Order

Run these before finishing any coding task:

```bash
pnpm lint
pnpm format:check
pnpm build
pnpm test
pnpm coverage
```

## Constraint Highlights

- TypeScript `strict: true`; no `any`, `as any`, or `as unknown`.
- Local imports use `.js` extensions.
- Write tests first, then the minimum code to pass.
- Keep diffs minimal and focused.
- The `dist/` folder is checked in; rebuild after code changes.
- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or similar git mutations unless the user explicitly asks.

## Spec Workflow

Feature specs live in `docs/specs/`, written in the to-spec model (Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes). When a new feature or change needs a spec, use the `/to-spec` skill to synthesize it from the conversation and write it under `docs/specs/`. Publish the spec to the issue tracker and apply the `ready-for-agent` label when the work is agent-ready.

## Cost-Conscious Patterns

- Start a fresh chat after planning; do not carry design context into implementation.
- Use file anchors and failing commands instead of pasting large logs, specs, or diff dumps.
- Prefer cheaper models for package updates, lint fixes, and narrow CI repairs.
- Reserve premium models for ambiguous architecture or review work.
- Keep slash-command invocations thin: minimal anchor, let the agent read repo artifacts.
