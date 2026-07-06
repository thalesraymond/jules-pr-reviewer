## 2024-07-06 - [Performance Optimization] Parallelize GitHub API Calls
**Learning:** Three distinct sequential GitHub API operations (`fetchDiff`, `loadRulesFromBase`, and `fetchOpenThreads`) in the main action execution loop did not depend on each other and added up to overall request latency unnecessarily.
**Action:** Always check whether consecutive async await calls can be run concurrently using `Promise.all` when they do not depend on the results of the preceding ones to optimize network request times and improve overall application throughput.
