import * as core from "@actions/core";
import type { getOctokit } from "@actions/github";
import type { DiffMode } from "./types.js";
import { getErrorMessage } from "./errors.js";

export interface ReusableSession {
  sessionId: string;
  followups: number;
}

/** Only the authenticated review author's latest Jules review can select a session. */
export async function findReusableSession(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  mode: DiffMode,
  maxFollowups: number
): Promise<ReusableSession | undefined> {
  try {
    const { viewer } = await octokit.graphql<{ viewer: { login: string } }>(
      "query { viewer { login } }"
    );
    const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });
    const latest = reviews
      .filter(
        (review) =>
          review.user?.login === viewer.login &&
          review.state !== "PENDING" &&
          review.body?.startsWith("<!-- jules-pr-reviewer -->\n")
      )
      .sort((a, b) => b.id - a.id)[0];
    // The marker must precede model-generated text, which may itself contain markers.
    const match = latest?.body?.match(
      /^<!-- jules-pr-reviewer -->\n<!-- jules-session: ([A-Za-z0-9_-]+) followups: (\d+) mode: (prompt|agentic) -->\n/
    );
    if (!match || match[3] !== mode) return undefined;
    const followups = Number(match[2]);
    if (!Number.isSafeInteger(followups) || followups >= maxFollowups)
      return undefined;
    return { sessionId: match[1], followups };
  } catch (err) {
    core.warning(
      `Session reuse lookup failed; starting fresh: ${getErrorMessage(err)}`
    );
    return undefined;
  }
}
