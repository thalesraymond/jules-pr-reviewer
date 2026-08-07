import { ReviewResult, Verdict, ReviewComment } from "./types.js";

export function parseReviewResponse(input: string): ReviewResult {
  const jsonPayload = extractJsonPayload(input);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPayload);
  } catch (e) {
    throw new Error("Failed to parse Jules response as JSON", { cause: e });
  }

  return strictValidateReviewResult(parsed);
}

function extractJsonPayload(input: string): string {
  const trimmed = input.trim();

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

function strictValidateReviewResult(parsed: unknown): ReviewResult {
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
        continue;
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
    changedFiles: Array.isArray(raw.changedFiles)
      ? (raw.changedFiles.filter(
          (f): f is string => typeof f === "string"
        ) as string[])
      : undefined,
  };
}
