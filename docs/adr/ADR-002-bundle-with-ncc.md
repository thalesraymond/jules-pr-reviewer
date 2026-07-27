# ADR-002: Bundle with @vercel/ncc and check dist/ into version control

## Status
Accepted

## Date
2026-06-14

## Context
GitHub Actions run by referencing a JavaScript file. Options are: (a) check in `node_modules` (huge, slow clones), (b) install dependencies at runtime (slow, network-dependent, costs CI minutes), or (c) bundle into a single file. We need fast, reliable action startup.

## Decision
Use `@vercel/ncc` to compile TypeScript into a single `dist/index.js` file. The `dist/` directory is checked into git. The action.yml `runs.main` points to `dist/index.js`. Husky pre-commit hook auto-rebuilds and stages `dist/` if it's stale.

## Alternatives Considered

### Check in node_modules
- Pros: Simple, no build step
- Cons: Bloats the repo, slows clones, hard to review diffs
- Rejected: Unacceptable repo size and clone performance

### Runtime install (ncc not checked in)
- Pros: Smaller repo, always fresh dependencies
- Cons: Adds ~30s to every action run, introduces network dependency, increases CI costs
- Rejected: Network dependency and added latency unacceptable for a CI action

### esbuild/rollup
- Pros: Fast builds, large ecosystem
- Cons: Less purpose-built for Node.js single-file bundling, CJS/ESM interop requires manual configuration
- Rejected: ncc is purpose-built for this exact use case and handles CJS/ESM interop well

## Consequences
- Bundle must be rebuilt after every source change (`pnpm build`)
- The pre-commit hook prevents stale bundles from being committed
- Bundle size is manageable (~500KB)
- The `dist/` directory must be included in the repository
