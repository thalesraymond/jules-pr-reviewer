import { minimatch } from "minimatch";
import { ReviewResult, Verdict, ReviewComment } from "./types.js";

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

export function extractJsonPayload(input: string): string {
  const trimmed = input.trim();

  // Prefer the outermost balanced JSON object. This is resilient to nested
  // markdown code fences (e.g. ```bash ... ```) inside JSON string values,
  // which a regex-based fence extractor would otherwise truncate.
  const balanced = extractBalancedJsonObject(trimmed);
  if (balanced) {
    return balanced;
  }

  const fencedBlockMatch = trimmed.match(
    /```(?:json|JSON)?\s*([\s\S]*?)\s*```/
  );
  if (fencedBlockMatch?.[1]) {
    return fencedBlockMatch[1].trim();
  }

  return trimmed;
}

function extractBalancedJsonObject(input: string): string | null {
  const start = input.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i++) {
    const char = input[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth++;
      continue;
    }

    if (char === "}") {
      depth--;
      if (depth === 0) {
        return input.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function strictValidateReviewResult(parsed: unknown): ReviewResult {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid or missing review result object");
  }

  const raw = parsed as Record<string, unknown>;

  const verdict = String(raw.verdict);
  if (!["approve", "comment", "block"].includes(verdict)) {
    throw new Error("Invalid or missing verdict in Jules response");
  }

  const summary =
    typeof raw.summary === "string" ? raw.summary : "No summary provided.";

  let resolvedCommentIds: number[] = [];
  if (Array.isArray(raw.resolvedCommentIds)) {
    resolvedCommentIds = raw.resolvedCommentIds.filter(
      (id): id is number => typeof id === "number"
    );
  }

  const newComments: ReviewComment[] = [];
  if (Array.isArray(raw.newComments)) {
    for (const rawComment of raw.newComments) {
      if (!rawComment || typeof rawComment !== "object") continue;
      const c = rawComment as Record<string, unknown>;

      if (
        typeof c.file !== "string" ||
        typeof c.line !== "number" ||
        typeof c.message !== "string"
      ) {
        continue; // Skip invalid comments without throwing, but ensure no fail-open.
      }

      let severity: "Info" | "Warning" | "High" = "Info";
      if (
        typeof c.severity === "string" &&
        ["Info", "Warning", "High"].includes(c.severity)
      ) {
        severity = c.severity as "Info" | "Warning" | "High";
      }

      let confidence: "Low" | "Medium" | "High" = "Low";
      if (
        typeof c.confidence === "string" &&
        ["Low", "Medium", "High"].includes(c.confidence)
      ) {
        confidence = c.confidence as "Low" | "Medium" | "High";
      }

      const comment: ReviewComment = {
        file: c.file,
        line: c.line,
        severity,
        confidence,
        message: c.message,
        promptForAgents:
          typeof c.promptForAgents === "string" ? c.promptForAgents : "",
      };

      if (typeof c.suggestion === "string") {
        comment.suggestion = c.suggestion;
      }
      if (typeof c.startLine === "number") {
        comment.startLine = c.startLine;
      }

      newComments.push(comment);
    }
  }

  return {
    summary,
    verdict: verdict as Verdict,
    resolvedCommentIds,
    newComments,
  };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error !== null && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}
