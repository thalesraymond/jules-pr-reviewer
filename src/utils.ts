export function sleep(ms: number): Promise<void> {
  if (ms < 0) {
    return Promise.reject(
      new Error("sleep delay must be a non-negative number")
    );
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function chunkArray<T>(array: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error("chunk size must be greater than 0");
  }
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}
