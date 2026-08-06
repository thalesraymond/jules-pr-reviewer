import * as github from "@actions/github";
import * as core from "@actions/core";
import { OpenThread, ReviewComment } from "./types.js";
import { withFallback, withRetry, getErrorMessage } from "./utils.js";

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

export async function fetchDiff(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pr: { number: number },
  baseShaForDiff: string,
  headSha: string
): Promise<string> {
  try {
    const compare = await octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${baseShaForDiff}...${headSha}`,
      mediaType: { format: "diff" },
    });
    const data = compare.data as unknown;
    if (typeof data === "string") return data;
  } catch (err) {
    core.warning(
      `compareCommitsWithBasehead failed, falling back to pulls.get: ${getErrorMessage(err)}`
    );
  }

  // fallback to full PR diff
  const res = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pr.number,
    mediaType: { format: "diff" },
  });
  const data = res.data as unknown;
  if (typeof data === "string") return data;

  throw new Error("GitHub returned no diff text.");
}

export async function loadRulesFromBase(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  path: string,
  baseSha: string
): Promise<string | undefined> {
  try {
    const file = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: baseSha,
    });
    if ("content" in file.data && typeof file.data.content === "string") {
      const content = Buffer.from(file.data.content, "base64").toString("utf8");
      core.info(`Loaded ${content.length} chars from ${path} at base SHA`);
      return content;
    }
    return undefined;
  } catch (err) {
    core.warning(`Failed to load rules from base: ${getErrorMessage(err)}`);
    return undefined;
  }
}

export async function fetchOpenThreads(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number
): Promise<OpenThread[]> {
  const query = `
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 1) {
                nodes {
                  body
                  path
                  line
                  author { login }
                  viewerDidAuthor
                }
              }
            }
          }
        }
      }
    }
  `;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: any = await octokit.graphql(query, {
    owner,
    repo,
    pr: prNumber,
  });
  const threads = response.repository?.pullRequest?.reviewThreads?.nodes || [];

  let index = 1;
  const result: OpenThread[] = [];
  for (const thread of threads) {
    if (thread.isResolved) continue;
    const firstComment = thread.comments.nodes[0];
    if (!firstComment) continue;
    if (
      firstComment.viewerDidAuthor &&
      firstComment.body.includes("<!-- jules-inline-comment -->")
    ) {
      result.push({
        index: index++,
        threadId: thread.id,
        path: firstComment.path,
        line: firstComment.line || 0,
        body: firstComment.body,
      });
    }
  }
  return result;
}

export async function resolveThreads(
  octokit: ReturnType<typeof github.getOctokit>,
  threadIds: string[]
): Promise<void> {
  for (const id of threadIds) {
    try {
      await withRetry(
        () =>
          octokit.graphql(
            `
          mutation($id: ID!) {
            resolveReviewThread(input: {threadId: $id}) {
              thread { isResolved }
            }
          }
        `,
            { id }
          ),
        { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 5000 }
      );
      core.info(`Resolved thread ${id}`);
    } catch (e) {
      core.warning(`Failed to resolve thread ${id}: ${e}`);
    }
  }
}

export async function submitReview(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  summary: string,
  comments: ReviewComment[]
): Promise<void> {
  const submitWithComments = (includeSuggestions: boolean) => async () => {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: headSha,
      event: "COMMENT",
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
      event: "COMMENT",
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

export async function setStatus(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  sha: string,
  context: string,
  state: "pending" | "success" | "failure" | "error",
  description: string
): Promise<void> {
  await withRetry(
    () =>
      octokit.rest.repos.createCommitStatus({
        owner,
        repo,
        sha,
        state,
        context,
        description,
      }),
    { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 5000 }
  );
}
