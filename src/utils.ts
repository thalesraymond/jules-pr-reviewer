/**
 * Executes a primary async function. If it throws an error that satisfies the
 * shouldFallback predicate, the fallback async function is executed instead.
 *
 * @param primary The primary async function to execute.
 * @param fallback The fallback async function to execute if primary fails.
 * @param shouldFallback A predicate that determines if the error warrants a fallback.
 * @returns The result of the primary or fallback function.
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: (error: unknown) => Promise<T>,
  shouldFallback: (error: unknown) => boolean
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    if (shouldFallback(error)) {
      return await fallback(error);
    }
    throw error;
  }
}

/**
 * Retries an asynchronous function with exponential backoff.
 *
 * @param operation The async function to execute.
 * @param maxAttempts Maximum number of attempts before throwing the error.
 * @param baseDelay Base delay in milliseconds for exponential backoff.
 * @param maxDelay Maximum delay in milliseconds.
 * @param shouldRetry A predicate to check if the error is retryable.
 * @returns The result of the operation.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number,
  baseDelay: number,
  maxDelay: number,
  shouldRetry: (error: unknown) => boolean
): Promise<T> {
  let delay = baseDelay;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, maxDelay);
    }
  }
  throw new Error("Retry loop exhausted"); // Should be unreachable
}
