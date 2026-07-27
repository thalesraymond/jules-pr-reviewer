# ADR-001: Use TypeScript with strict mode and ES modules

## Status
Accepted

## Date
2026-06-14

## Context
We need a type-safe language for a GitHub Action that handles untrusted PR content. The action must run on Node 24 (the GitHub Actions runner). We want strong type checking to catch bugs early, especially around security-sensitive code paths.

## Decision
Use TypeScript 6 with `strict: true` (includes strictNullChecks, noImplicitAny, etc.), `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`. Package declares `"type": "module"` and local imports use `.js` extensions (required by ESM + bundler resolution). Ban `any`, `as any`, and `as unknown` — every type must be explicit.

## Alternatives Considered

### JavaScript (plain)
- Pros: No compilation step, wider contributor pool
- Cons: No compile-time type safety, too risky for untrusted-input handling
- Rejected: Cannot guarantee type correctness at commit time; security-sensitive code paths require strong guarantees

### TypeScript without strict mode
- Pros: Easier onboarding, fewer type annotations required
- Cons: Does not catch null/undefined bugs that are common when parsing GitHub payloads
- Rejected: `strict: true` catches the class of bugs most likely to cause runtime failures in payload parsing

## Consequences
- All code must pass `tsc --noEmit` without errors
- Developers must use `.js` extensions in local imports
- New contributors may find the `.js` extension convention unusual but the linter enforces it
- Every type must be explicit — no `any`, `as any`, or `as unknown` bypasses allowed
