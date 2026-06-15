export interface RetryOptions {
  /**
   * The maximum number of retry attempts. Defaults to 3.
   */
  maxRetries?: number;
  /**
   * The initial delay between retries in milliseconds. Defaults to 1000.
   */
  initialDelayMs?: number;
  /**
   * The maximum delay between retries in milliseconds. Defaults to 10000.
   */
  maxDelayMs?: number;
  /**
   * A multiplier applied to the delay after each retry. Defaults to 2.
   */
  backoffFactor?: number;
  /**
   * A function to determine if an error should trigger a retry.
   * By default, it retries on any error.
   */
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Executes an asynchronous function with exponential backoff and retry logic.
 *
 * @param operation The asynchronous function to execute.
 * @param options Configuration for retry behavior.
 * @returns A promise that resolves with the result of the operation.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = Math.max(0, options.maxRetries ?? 3);
  let delay = Math.max(0, options.initialDelayMs ?? 1000);
  const maxDelay = Math.max(0, options.maxDelayMs ?? 10000);
  const backoffFactor = Math.max(1, options.backoffFactor ?? 2);
  const shouldRetry = options.shouldRetry ?? (() => true);

  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error)) {
        throw error;
      }

      attempt++;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }
}
