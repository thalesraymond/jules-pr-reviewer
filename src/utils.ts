export function sleep(ms: number): Promise<void> {
  if (ms < 0) {
    return Promise.reject(
      new Error("sleep delay must be a non-negative number")
    );
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mapConcurrent<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  if (concurrency <= 0) {
    throw new Error("Concurrency must be greater than 0");
  }

  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (currentIndex < items.length) {
        const index = currentIndex++;
        results[index] = await mapper(items[index], index);
      }
    }
  );

  await Promise.all(workers);
  return results;
}
