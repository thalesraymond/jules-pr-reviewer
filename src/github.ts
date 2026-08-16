import * as github from "@actions/github";
import * as core from "@actions/core";
import { CheckRunAnnotation, OpenThread } from "./types.js";
import {
  withRetry,
  isRetryableGithubError,
  RetryOptions,
} from "./resilience.js";
import { getErrorMessage } from "./errors.js";

const GITHUB_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 5000,
  shouldRetry: isRetryableGithubError,
};

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
  const data = await getContentWithWarning(
    octokit,
    owner,
    repo,
    path,
    baseSha,
    "Failed to load rules from base"
  );
  if (
    data !== undefined &&
    typeof data === "object" &&
    data !== null &&
    "content" in data
  ) {
    const { content } = data as { content?: unknown };
    if (typeof content === "string") {
      const decoded = Buffer.from(content, "base64").toString("utf8");
      core.info(`Loaded ${decoded.length} chars from ${path} at base SHA`);
      return decoded;
    }
  }
  return undefined;
}

async function getContentWithWarning(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  warnMessage: string
): Promise<unknown> {
  try {
    const res = await octokit.rest.repos.getContent({ owner, repo, path, ref });
    return res.data;
  } catch (err) {
    core.warning(`${warnMessage}: ${getErrorMessage(err)}`);
    return undefined;
  }
}

export async function listFilesInDirectory(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  dirPath: string,
  refSha: string
): Promise<string[]> {
  const files: string[] = [];

  const visit = async (dir: string): Promise<void> => {
    const data = await getContentWithWarning(
      octokit,
      owner,
      repo,
      dir,
      refSha,
      `Failed to list files in ${dir} at ${refSha}`
    );

    if (data === undefined) {
      return;
    }

    if (!Array.isArray(data)) {
      core.warning(`Expected a directory at ${dir}, but found a file.`);
      return;
    }

    for (const entry of data) {
      if (entry.type === "file" && typeof entry.path === "string") {
        files.push(entry.path);
      } else if (entry.type === "dir" && typeof entry.path === "string") {
        await visit(entry.path);
      }
    }
  };

  await visit(dirPath);
  return files;
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
        GITHUB_RETRY_OPTIONS
      );
      core.info(`Resolved thread ${id}`);
    } catch (e) {
      core.warning(`Failed to resolve thread ${id}: ${e}`);
    }
  }
}

export async function createCheckRun(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  name: string,
  headSha: string
): Promise<number> {
  const result = await withRetry(
    () =>
      octokit.rest.checks.create({
        owner,
        repo,
        name,
        head_sha: headSha,
        status: "in_progress",
      }),
    GITHUB_RETRY_OPTIONS
  );
  return result.data.id;
}

export interface CheckRunOutput {
  title: string;
  summary: string;
  annotations?: CheckRunAnnotation[];
}

export async function finalizeCheckRun(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  checkRunId: number,
  conclusion: "success" | "failure" | "neutral",
  output: CheckRunOutput
): Promise<void> {
  const params: Record<string, unknown> = {
    owner,
    repo,
    check_run_id: checkRunId,
    status: "completed",
    conclusion,
    output: {
      title: output.title,
      summary: output.summary,
      ...(output.annotations && output.annotations.length > 0
        ? {
            annotations: output.annotations.map((a) => ({
              path: a.path,
              start_line: a.startLine,
              end_line: a.endLine,
              annotation_level: a.annotationLevel,
              message: a.message,
              ...(a.title ? { title: a.title } : {}),
            })),
          }
        : {}),
    },
  };
  await withRetry(
    () =>
      octokit.rest.checks.update(
        params as Parameters<typeof octokit.rest.checks.update>[0]
      ),
    GITHUB_RETRY_OPTIONS
  );
}
