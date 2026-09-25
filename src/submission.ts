import * as core from "@actions/core";
import { ReviewComment, CheckRunAnnotation } from "./types.js";
import { withFallback } from "./resilience.js";
import { getErrorMessage } from "./errors.js";

const SUGGESTION_ATTRIBUTION =
  "> ⚠️ Jules suggested this fix — review carefully before applying.";

const SUGGESTIONS_OMITTED_NOTE =
  "> ⚠️ GitHub rejected the suggested changes in this review, so they were omitted. All reported findings are still posted as inline comments.";

const INLINE_FINDINGS_OMITTED_NOTE =
  "> ⚠️ GitHub rejected inline comments for this review, so it was posted as a summary only. The reported finding counts are unchanged.";

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

export type ReviewDeliveryState =
  "inline_with_suggestions" | "inline_without_suggestions" | "summary_only";

export type ReviewDeliveryLoss =
  "suggestions_omitted" | "inline_findings_omitted";

export type ReviewDelivery = {
  /** What GitHub accepted for this review submission. */
  state: ReviewDeliveryState;
} & (
  | {
      /** Delivery was not degraded by a fallback. */
      degraded: false;
    }
  | {
      /** A fallback dropped suggestions or inline findings. */
      degraded: true;
      /** What the accepted fallback dropped. */
      loss: ReviewDeliveryLoss;
    }
);

export async function submitReview(
  octokit: ReturnType<typeof import("@actions/github").getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  summary: string,
  comments: ReviewComment[],
  reviewEvent: "COMMENT" | "APPROVE" = "COMMENT"
): Promise<ReviewDelivery> {
  const hasFindings = comments.length > 0;
  const hasSuggestions = comments.some((c) => c.suggestion);

  const postReview = (
    body: string,
    reviewComments: ReviewComment[],
    includeSuggestions: boolean
  ): Promise<unknown> =>
    octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: headSha,
      event: reviewEvent,
      body,
      comments: reviewComments.map((c) =>
        buildApiComment(c, includeSuggestions)
      ),
    });

  const submitFirstAttempt = async (): Promise<ReviewDelivery> => {
    await postReview(summary, comments, true);

    if (!hasFindings) {
      return { state: "summary_only", degraded: false };
    }
    return hasSuggestions
      ? { state: "inline_with_suggestions", degraded: false }
      : { state: "inline_without_suggestions", degraded: false };
  };

  const submitWithoutSuggestions = async (): Promise<ReviewDelivery> => {
    core.warning(
      "Failed to submit review with suggestions (likely hunk boundary). Retrying without suggestions."
    );
    await postReview(
      `${summary}\n\n${SUGGESTIONS_OMITTED_NOTE}`,
      comments,
      false
    );
    return {
      state: "inline_without_suggestions",
      degraded: true,
      loss: "suggestions_omitted",
    };
  };

  const submitSummaryOnly = async (error: unknown): Promise<ReviewDelivery> => {
    core.warning(
      hasFindings
        ? `Failed to submit inline review comments (likely due to large diff/Unprocessable Entity). Falling back to summary-only review. Error: ${error}`
        : `Failed to submit summary-only review. Retrying. Error: ${error}`
    );
    await postReview(
      hasFindings ? `${summary}\n\n${INLINE_FINDINGS_OMITTED_NOTE}` : summary,
      [],
      true
    );
    return hasFindings
      ? {
          state: "summary_only",
          degraded: true,
          loss: "inline_findings_omitted",
        }
      : { state: "summary_only", degraded: false };
  };

  if (hasSuggestions) {
    return withFallback(
      submitFirstAttempt,
      async () =>
        withFallback(
          submitWithoutSuggestions,
          submitSummaryOnly,
          isUnprocessableEntity
        ),
      isUnprocessableEntity
    );
  }

  return withFallback(
    submitFirstAttempt,
    submitSummaryOnly,
    isUnprocessableEntity
  );
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
