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

## OpenSpec Workflow

Use the prompt-backed flows in `.github/prompts/`:

| Slash command | Prompt file | Purpose |
| ------------- | ----------- | ------- |
| `/opsx:explore` | `.github/prompts/opsx-explore.prompt.md` | Clarify requirements and investigate |
| `/opsx:propose` | `.github/prompts/opsx-propose.prompt.md` | Create a bounded change proposal |
| `/opsx:apply` | `.github/prompts/opsx-apply.prompt.md` | Implement an approved change |
| `/opsx:archive` | `.github/prompts/opsx-archive.prompt.md` | Close out a completed change |

Implementation details for each stage live in the corresponding `.github/skills/openspec-*` directory.

## Cost-Conscious Patterns

- Start a fresh chat after planning; do not carry design context into implementation.
- Use file anchors and failing commands instead of pasting large logs, specs, or diff dumps.
- Prefer cheaper models for package updates, lint fixes, and narrow CI repairs.
- Reserve premium models for ambiguous architecture or review work.
- Keep slash-command invocations thin: minimal anchor, let the agent read repo artifacts.
