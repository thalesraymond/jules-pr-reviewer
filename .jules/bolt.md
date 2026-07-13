## 2024-07-06 - [Performance Optimization] Parallelize GitHub API Calls
**Learning:** Three distinct sequential GitHub API operations (`fetchDiff`, `loadRulesFromBase`, and `fetchOpenThreads`) in the main action execution loop did not depend on each other and added up to overall request latency unnecessarily.
**Action:** Always check whether consecutive async await calls can be run concurrently using `Promise.all` when they do not depend on the results of the preceding ones to optimize network request times and improve overall application throughput.

## 2024-07-06 - [Performance Optimization] Rejected: Unbounded GitHub API Concurrency
**Learning:** An attempt was made to parallelize GraphQL thread resolution using `Promise.all` over an array of thread IDs. This was rejected because GitHub's API guidelines strictly advise against making concurrent API mutations to avoid triggering secondary rate limits and abuse detection.
**Action:** When dealing with multiple independent external API mutation calls, especially against rate-limited endpoints like GitHub, stick to sequential operations or use bounded concurrency with proper throttling/retry mechanisms rather than unbounded `Promise.all`.

## 2024-07-06 - [Performance Optimization] Delay Instantiations on Early Returns
**Learning:** Instantiating complex objects (like `github.getOctokit()`) or performing `Array.prototype.map()` mapping operations before early returns causes unnecessary garbage collection pressure and CPU overhead for requests that end up being skipped.
**Action:** When working in entry-point handlers, always place early returns as close to the beginning as possible, and delay any memory allocations, heavy mappings, and object instantiations until after all basic skip conditions are evaluated.
