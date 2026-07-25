import { minimatch } from "minimatch";
import { ReviewResult, ReviewComment, Verdict } from "./types.js";

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
  const splitList = (raw: string): string[] =>
    raw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .map((s) => s.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"))
      .filter((s) => s.length > 0);

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
    } catch {
      return splitList(trimmed.slice(1, -1));
    }
  }

  return splitList(trimmed);
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

    try {
      if (minimatch(normalizedFilePath, normalizedPattern, { dot: true })) {
        return true;
      }
    } catch {
      // Ignore invalid patterns rather than failing the whole action
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

    const headerMatch = section.match(
      /^diff --git (?:"a\/([^"]+)"|a\/(\S+)) (?:"b\/([^"]+)"|b\/(\S+))/m
    );
    if (headerMatch) {
      const pathA = (headerMatch[1] ?? headerMatch[2])!;
      const pathB = (headerMatch[3] ?? headerMatch[4])!;
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

/**
 * Strictly validates and normalizes the parsed JSON review result to prevent runtime errors and security bypasses.
 * Defaults to a secure fallback if validation fails.
 */
export function validateAndNormalizeReviewResult(
  parsed: unknown
): ReviewResult {
  // Safe secure fallback default
  const fallbackResult: ReviewResult = {
    summary:
      "Jules returned an invalid response structure. Falling back to a secure blocking state.",
    verdict: "block",
    resolvedCommentIds: [],
    newComments: [],
  };

  if (!parsed || typeof parsed !== "object") {
    return fallbackResult;
  }

  const record = parsed as Record<string, unknown>;

  // 1. Validate verdict strictly (must be approve, comment, or block)
  const rawVerdict = record.verdict;
  let verdict: Verdict;
  if (
    rawVerdict === "approve" ||
    rawVerdict === "comment" ||
    rawVerdict === "block"
  ) {
    verdict = rawVerdict;
  } else {
    // If verdict is missing or unrecognized, default to 'block' to prevent fail-open bypass.
    return fallbackResult;
  }

  // 2. Validate summary
  const summary =
    typeof record.summary === "string" ? record.summary.trim() : "";
  if (!summary) {
    return fallbackResult;
  }

  // 3. Validate resolvedCommentIds
  let resolvedCommentIds: number[] = [];
  if (Array.isArray(record.resolvedCommentIds)) {
    resolvedCommentIds = record.resolvedCommentIds
      .map((id) => (typeof id === "number" ? id : parseInt(String(id), 10)))
      .filter((id) => !isNaN(id));
  }

  // 4. Validate newComments array
  const newComments: ReviewComment[] = [];
  if (Array.isArray(record.newComments)) {
    for (const item of record.newComments) {
      if (!item || typeof item !== "object") continue;
      const c = item as Record<string, unknown>;

      const file = typeof c.file === "string" ? c.file.trim() : "";
      if (!file) continue; // File path is required for line comments

      // Parse and validate line number
      let line = 0;
      if (typeof c.line === "number") {
        line = c.line;
      } else if (typeof c.line === "string") {
        line = parseInt(c.line, 10);
      }
      if (isNaN(line) || line < 0) {
        line = 0;
      }

      // Validate severity
      let severity: "Info" | "Warning" | "High" = "Info";
      if (
        c.severity === "Info" ||
        c.severity === "Warning" ||
        c.severity === "High"
      ) {
        severity = c.severity;
      }

      // Validate confidence
      let confidence: "Low" | "Medium" | "High" = "Medium";
      if (
        c.confidence === "Low" ||
        c.confidence === "Medium" ||
        c.confidence === "High"
      ) {
        confidence = c.confidence;
      }

      const message = typeof c.message === "string" ? c.message.trim() : "";
      if (!message) continue; // Message is required

      const promptForAgents =
        typeof c.promptForAgents === "string" ? c.promptForAgents.trim() : "";

      newComments.push({
        file,
        line,
        severity,
        confidence,
        message,
        promptForAgents,
      });
    }
  }

  return {
    summary,
    verdict,
    resolvedCommentIds,
    newComments,
  };
}
