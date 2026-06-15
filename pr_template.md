Title: "🚀 Catalyst: [Enhancement] Add and integrate filterLockfilesFromDiff"

Description:
🎯 **Purpose:** Code reviews by AI agents are often cluttered and noisy when large, auto-generated lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, etc.) are included in the diff. This new feature filters lockfiles out to save massive amounts of context tokens and improve review focus and accuracy.
🔧 **Implementation:** A new utility `filterLockfilesFromDiff` is created inside `src/github.ts`. The utility safely splits Git diff outputs using standard chunk demarcations (`^diff --git `) and strips out chunks corresponding to common lockfiles. It properly reformats the diff afterwards.
🔗 **Integration:** `filterLockfilesFromDiff` is actively utilized directly in the `fetchDiff` function inside `src/github.ts`. All diffs retrieved via standard GitHub API calls or fallback API calls are safely processed through this filter before being sent downstream to the AI agent.
✅ **Verification:** Added dedicated suite of tests in `tests/github.test.ts` to assert that `filterLockfilesFromDiff` accurately extracts lockfiles, ignores generic un-matched chunks, handles missing lockfile diffs safely, and elegantly manages diffs comprising entirely of lockfiles. `pnpm test`, `pnpm lint`, and `pnpm build` pipelines pass successfully. Code coverage matches the 100% threshold for `src/github.ts`.
