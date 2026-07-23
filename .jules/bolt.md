## 2024-07-06 - [Performance Optimization] Parallelize GitHub API Calls
**Learning:** Three distinct sequential GitHub API operations (`fetchDiff`, `loadRulesFromBase`, and `fetchOpenThreads`) in the main action execution loop did not depend on each other and added up to overall request latency unnecessarily.
**Action:** Always check whether consecutive async await calls can be run concurrently using `Promise.all` when they do not depend on the results of the preceding ones to optimize network request times and improve overall application throughput.

## 2024-07-06 - [Performance Optimization] Defer Instantiation and Optimizing Array Traversal
**Learning:** Instantiating complex objects (like `github.getOctokit()`) or performing whole-array transformations (like `.map(l => l.name)`) before executing early returns wastes memory and CPU cycles on code paths that end up being skipped.
**Action:** Always place data instantiations and heavy array computations after early returns when those variables are only needed in the primary execution flow. Use early-termination methods like `.some()` instead of `.map().includes()` to prevent intermediate allocations and unneeded traversal.
