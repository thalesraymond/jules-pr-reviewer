export function sleep(ms: number): Promise<void> {
  if (ms < 0) {
    return Promise.reject(
      new Error("sleep delay must be a non-negative number")
    );
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Maps an array of items asynchronously with a bounded concurrency limit.
 *
 * This utility allows for concurrent execution of asynchronous operations
 * while ensuring that no more than `concurrency` operations are running at the same time.
 * If any operation fails, it waits for the currently running operations to settle
 * and then throws the first encountered error.
 *
 * @param items The array of items to map over.
 * @param mapper The async mapping function applied to each item.
 * @param concurrency The maximum number of concurrent executions allowed.
 * @returns A promise that resolves to an array of the mapped results.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const running = new Set<Promise<void>>();
  const errors: unknown[] = [];

  for (let i = 0; i < items.length; i++) {
    if (errors.length > 0) break;

    const p = mapper(items[i], i)
      .then((res) => {
        results[i] = res;
      })
      .catch((err) => {
        errors.push(err);
      })
      .finally(() => {
        running.delete(p);
      });

    running.add(p);
    if (running.size >= Math.max(1, concurrency)) {
      await Promise.race(running);
    }
  }

  await Promise.all(running);
  if (errors.length > 0) throw errors[0];
  return results;
}
