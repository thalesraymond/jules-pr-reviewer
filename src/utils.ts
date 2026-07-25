import { minimatch } from "minimatch";

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

export function parseIgnoredPaths(input?: string): string[] {
  if (!input || !input.trim()) {
    return [];
  }
  const trimmed = input.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
    } catch {
      // Fallback if JSON parsing fails
    }
  }
  return trimmed
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function shouldIgnorePath(
  filePath: string,
  ignoredPatterns: string[]
): boolean {
  if (!ignoredPatterns || ignoredPatterns.length === 0) {
    return false;
  }
  const normalizedFilePath = filePath.replace(/\\/g, "/");

  for (const pattern of ignoredPatterns) {
    const normalizedPattern = pattern.replace(/\\/g, "/");

    const cleanPattern = normalizedPattern.endsWith("/")
      ? normalizedPattern.slice(0, -1)
      : normalizedPattern;

    if (
      normalizedFilePath === cleanPattern ||
      normalizedFilePath.startsWith(cleanPattern + "/")
    ) {
      return true;
    }

    if (minimatch(normalizedFilePath, normalizedPattern, { dot: true })) {
      return true;
    }

    if (
      !normalizedPattern.endsWith("**") &&
      minimatch(normalizedFilePath, `${cleanPattern}/**`, { dot: true })
    ) {
      return true;
    }
  }

  return false;
}

export function filterDiff(diff: string, ignoredPatterns: string[]): string {
  if (!diff || !ignoredPatterns || ignoredPatterns.length === 0) {
    return diff;
  }

  const sections = diff.split(/(?=^diff --git )/m);
  const keptSections: string[] = [];

  for (const section of sections) {
    if (!section.trim()) continue;

    const headerMatch = section.match(/^diff --git a\/(\S+) b\/(\S+)/m);
    if (headerMatch) {
      const [, pathA, pathB] = headerMatch;
      const isPathAIgnored =
        pathA !== "dev/null" && shouldIgnorePath(pathA, ignoredPatterns);
      const isPathBIgnored =
        pathB !== "dev/null" && shouldIgnorePath(pathB, ignoredPatterns);

      if (isPathAIgnored || isPathBIgnored) {
        continue;
      }
    }

    keptSections.push(section);
  }

  return keptSections.join("");
}
