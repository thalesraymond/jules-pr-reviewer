import { getErrorMessage } from "./errors.js";

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Whether a GitHub API error is transient and worth retrying. 5xx, 429, and
 * rate-limit/abuse-detection responses benefit from backoff; auth and
 * permission errors are deterministic and should fail fast.
 */
export function isRetryableGithubError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /(?:\b5\d\d\b|\b429\b|\brate limit\b|\bsecondary rate limit\b|\babuse detection\b)/i.test(
    message
  );
}

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
