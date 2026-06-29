## 2025-06-29 - Parallelize independent network requests
**Learning:** Sequential await calls for independent data fetching operations (`fetchDiff`, `loadRulesFromBase`, `fetchOpenThreads`) create a performance bottleneck in the PR action initialization.
**Action:** Use `Promise.all` to fetch independent data concurrently to reduce overall wait time.
