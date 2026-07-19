import * as github from "@actions/github";
import * as core from "@actions/core";
import { OpenThread, ReviewComment } from "./types.js";
import { withFallback, withRetry } from "./utils.js";

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
      `compareCommitsWithBasehead failed, falling back to pulls.get: ${String(err)}`
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
    core.warning(`Failed to load rules from base: ${String(err)}`);
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
  const formattedComments = comments.map((c) => {
    const severityEmoji =
      c.severity === "High" ? "🚨" : c.severity === "Warning" ? "⚠️" : "ℹ️";
    const confidenceEmoji =
      c.confidence === "High" ? "🟢" : c.confidence === "Medium" ? "🟡" : "🔴";

    let body = `<!-- jules-inline-comment -->
**Severity:** ${severityEmoji} ${c.severity} | **Confidence:** ${confidenceEmoji} ${c.confidence}

${c.message}`;

    if (c.promptForAgents) {
      body += `

<details>
<summary>🤖 Prompt for Agents</summary>

${c.promptForAgents}
</details>`;
    }

    return {
      path: c.file,
      line: c.line,
      side: "RIGHT" as const,
      body,
    };
  });

  await withFallback(
    async () => {
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: headSha,
        event: "COMMENT",
        body: summary,
        comments: formattedComments,
      });
    },
    async (error) => {
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
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (error: any) =>
      error?.status === 422 || String(error).includes("Unprocessable Entity")
  );
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
