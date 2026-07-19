/**
 * Executes a primary async function. If it throws an error that satisfies the
 * shouldFallback predicate, the fallback async function is executed instead.
 *
 * @param primary The primary async function to execute.
 * @param fallback The fallback async function to execute if primary fails.
 * @param shouldFallback A predicate that determines if the error warrants a fallback.
 * @returns The result of the primary or fallback function.
 */
export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Retries an async operation with exponential backoff.
 *
 * @param operation The async operation to execute.
 * @param options Configuration for retries and backoff.
 * @returns The result of the operation.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, initialDelayMs, maxDelayMs, shouldRetry } = options;
  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || (shouldRetry && !shouldRetry(error))) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));

      attempt++;
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
}

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
