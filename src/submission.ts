import * as core from "@actions/core";
import { ReviewComment, CheckRunAnnotation } from "./types.js";
import { withFallback } from "./resilience.js";
import { getErrorMessage } from "./errors.js";

const SUGGESTION_ATTRIBUTION =
  "> ⚠️ Jules suggested this fix — review carefully before applying.";

function sanitizeSuggestion(comment: ReviewComment): ReviewComment {
  const sanitized: ReviewComment = { ...comment };

  if (
    sanitized.startLine !== undefined &&
    sanitized.startLine > sanitized.line
  ) {
    delete sanitized.startLine;
  }

  if (sanitized.suggestion !== undefined) {
    sanitized.suggestion = sanitized.suggestion.replace(/```/g, "'''");
  }

  return sanitized;
}

function formatCommentBody(
  comment: ReviewComment,
  includeSuggestion: boolean
): string {
  const severityEmoji =
    comment.severity === "High"
      ? "🚨"
      : comment.severity === "Warning"
        ? "⚠️"
        : "ℹ️";
  const confidenceEmoji =
    comment.confidence === "High"
      ? "🟢"
      : comment.confidence === "Medium"
        ? "🟡"
        : "🔴";

  let body = `<!-- jules-inline-comment -->
**Severity:** ${severityEmoji} ${comment.severity} | **Confidence:** ${confidenceEmoji} ${comment.confidence}

${comment.message}`;

  if (includeSuggestion && comment.suggestion) {
    body += `

${SUGGESTION_ATTRIBUTION}

\`\`\`suggestion
${comment.suggestion}
\`\`\``;
  }

  if (comment.promptForAgents) {
    // Sanitize user input to prevent XSS and breaking out of details tag
    const sanitizedPrompt = comment.promptForAgents.replace(
      /<\/details\s*>/gi,
      "&lt;/details&gt;"
    );
    body += `

<details>
<summary>🤖 Prompt for Agents</summary>

${sanitizedPrompt}
</details>`;
  }

  return body;
}

function buildApiComment(
  comment: ReviewComment,
  includeSuggestion: boolean
): {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
  start_line?: number;
} {
  const sanitized = sanitizeSuggestion(comment);
  const apiComment: {
    path: string;
    line: number;
    side: "RIGHT";
    body: string;
    start_line?: number;
  } = {
    path: sanitized.file,
    line: sanitized.line,
    side: "RIGHT" as const,
    body: formatCommentBody(
      includeSuggestion ? sanitized : { ...sanitized, suggestion: undefined },
      includeSuggestion
    ),
  };

  if (includeSuggestion && sanitized.startLine !== undefined) {
    apiComment.start_line = sanitized.startLine;
  }

  return apiComment;
}

function isUnprocessableEntity(error: unknown): boolean {
  return (
    (error as { status?: number })?.status === 422 ||
    getErrorMessage(error).includes("Unprocessable Entity")
  );
}

export async function submitReview(
  octokit: ReturnType<typeof import("@actions/github").getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  summary: string,
  comments: ReviewComment[],
  reviewEvent: "COMMENT" | "APPROVE" = "COMMENT"
): Promise<void> {
  const submitWithComments = (includeSuggestions: boolean) => async () => {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: headSha,
      event: reviewEvent,
      body: summary,
      comments: comments.map((c) => buildApiComment(c, includeSuggestions)),
    });
  };

  const fallbackToSummaryOnly = async (error: unknown) => {
    core.warning(
      `Failed to submit inline review comments (likely due to large diff/Unprocessable Entity). Falling back to summary-only review. Error: ${error}`
    );
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: headSha,
      event: reviewEvent,
      body: summary,
      comments: [],
    });
  };

  const hasSuggestions = comments.some((c) => c.suggestion);

  if (hasSuggestions) {
    await withFallback(
      submitWithComments(true),
      async () => {
        core.warning(
          "Failed to submit review with suggestions (likely hunk boundary). Retrying without suggestions."
        );
        await withFallback(
          submitWithComments(false),
          fallbackToSummaryOnly,
          isUnprocessableEntity
        );
      },
      isUnprocessableEntity
    );
  } else {
    await withFallback(
      submitWithComments(true),
      fallbackToSummaryOnly,
      isUnprocessableEntity
    );
  }
}

const MAX_ANNOTATIONS = 50;

function severityToAnnotationLevel(
  severity: ReviewComment["severity"]
): CheckRunAnnotation["annotationLevel"] {
  switch (severity) {
    case "High":
      return "failure";
    case "Warning":
      return "warning";
    case "Info":
      return "notice";
  }
}

export function buildAnnotations(
  comments: ReviewComment[]
): CheckRunAnnotation[] {
  return comments.slice(0, MAX_ANNOTATIONS).map((c) => ({
    path: c.file,
    startLine: c.startLine ?? c.line,
    endLine: c.line,
    annotationLevel: severityToAnnotationLevel(c.severity),
    message: c.message,
  }));
}
