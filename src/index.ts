import * as core from "@actions/core";
import * as github from "@actions/github";
import { FailOn, Verdict } from "./types.js";
import {
  fetchDiff,
  loadRulesFromBase,
  fetchOpenThreads,
  resolveThreads,
  submitReview,
  setStatus,
} from "./github.js";
import { runJulesReview, wrapPermissionError } from "./jules.js";
import { buildReviewPrompt } from "./prompt.js";

const COMMENT_MARKER = "<!-- jules-pr-reviewer -->";
const VALID_FAIL_ON: FailOn[] = ["never", "blocking", "any"];

async function run(): Promise<void> {
  const apiKey = core.getInput("jules_api_key", { required: true });
  core.setSecret(apiKey);

  const token = core.getInput("github_token", { required: true });
  const failOnRaw = core.getInput("fail_on");
  if (!VALID_FAIL_ON.includes(failOnRaw as FailOn)) {
    core.setFailed(
      `Invalid fail_on: "${failOnRaw}". Must be one of: ${VALID_FAIL_ON.join(", ")}.`
    );
    return;
  }
  const failOn = failOnRaw as FailOn;
  const skipDrafts = core.getBooleanInput("skip_drafts");
  const skipForks = core.getBooleanInput("skip_forks");
  const bypassLabel = core.getInput("bypass_label");
  const statusContext = core.getInput("status_context");
  const extraInstructions = core.getInput("extra_instructions");
  const rulesFilePath = core.getInput("rules_file");
  const timeoutMinutesRaw = core.getInput("timeout_minutes") || "30";
  const timeoutMinutes = Math.max(1, parseInt(timeoutMinutesRaw, 10) || 30);

  const ctx = github.context;
  if (ctx.eventName === "pull_request_target") {
    core.setFailed(
      "pull_request_target is not supported — it runs with base-repo write tokens and exposes the action to prompt-injection via attacker-controlled diffs. Use on: pull_request instead."
    );
    return;
  }
  if (ctx.eventName !== "pull_request") {
    core.setFailed(
      `Unsupported event: ${ctx.eventName}. Use on: pull_request.`
    );
    return;
  }

  const pr = ctx.payload.pull_request;
  if (!pr) {
    core.setFailed("No pull_request payload found.");
    return;
  }

  const owner = ctx.repo.owner;
  const repo = ctx.repo.repo;
  const prNumber = pr.number;
  const headSha: string = pr.head.sha;
  const baseSha: string = pr.base.sha;
  const isDraft: boolean = !!pr.draft;
  const isFork: boolean = pr.head.repo?.full_name !== `${owner}/${repo}`;
  const labels: string[] = (pr.labels || []).map(
    (l: { name: string }) => l.name
  );

  const octokit = github.getOctokit(token);

  if (isDraft && skipDrafts) {
    core.info("Skipping draft PR.");
    return;
  }
  if (isFork && skipForks) {
    core.info("Skipping fork PR (skip_forks=true).");
    return;
  }
  if (labels.includes(bypassLabel)) {
    core.info(`Bypass label "${bypassLabel}" present — skipping review.`);
    return;
  }

  try {
    try {
      await setStatus(
        octokit,
        owner,
        repo,
        headSha,
        statusContext,
        "pending",
        "Jules is reviewing this PR…"
      );
    } catch (err) {
      throw wrapPermissionError(err, "statuses:write", "createCommitStatus");
    }

    // Determine the base SHA for incremental diffing
    let baseShaForDiff = baseSha;
    if (ctx.payload.action === "synchronize" && ctx.payload.before) {
      baseShaForDiff = ctx.payload.before;
      core.info(
        `Synchronize event detected. Reviewing incremental changes from ${baseShaForDiff} to ${headSha}`
      );
    } else {
      core.info(`Reviewing full PR diff from ${baseShaForDiff} to ${headSha}`);
    }

    const diff = await fetchDiff(
      octokit,
      owner,
      repo,
      pr,
      baseShaForDiff,
      headSha
    );

    let rulesFromFile: string | undefined;
    if (rulesFilePath) {
      rulesFromFile = await loadRulesFromBase(
        octokit,
        owner,
        repo,
        rulesFilePath,
        baseSha
      );
    }

    const { text: diffText, truncatedNote } = truncateDiff(diff, 80_000);

    const openThreads = await fetchOpenThreads(octokit, owner, repo, prNumber);

    const prompt = buildReviewPrompt({
      repoFullName: `${owner}/${repo}`,
      prNumber,
      prTitle: pr.title || "",
      prBody: pr.body || "",
      diff: diffText,
      diffTruncatedNote: truncatedNote,
      extraInstructions: extraInstructions || undefined,
      rulesFromFile,
      openThreads,
    });

    const { reviewResult, sessionId } = await runJulesReview(
      apiKey,
      prompt,
      { github: `${owner}/${repo}`, baseBranch: pr.base.ref },
      timeoutMinutes
    );

    if (!reviewResult) {
      await setStatus(
        octokit,
        owner,
        repo,
        headSha,
        statusContext,
        "error",
        "Jules did not return a valid review in time"
      );
      core.setFailed(
        `Jules returned no review message within ${timeoutMinutes} minutes.`
      );
      return;
    }

    const { verdict, summary, resolvedCommentIds, newComments } = reviewResult;

    // Resolve threads that the LLM identified as fixed
    if (resolvedCommentIds && resolvedCommentIds.length > 0) {
      const threadIdsToResolve = openThreads
        .filter((t) => resolvedCommentIds.includes(t.index))
        .map((t) => t.threadId);

      if (threadIdsToResolve.length > 0) {
        await resolveThreads(octokit, threadIdsToResolve);
      }
    }

    // Prepare body for the PR review
    const finalBody = `${COMMENT_MARKER}\n## 🤖 Jules Review\n\n${summary}\n\n---\n_Session: \`${sessionId}\`_`;

    await submitReview(
      octokit,
      owner,
      repo,
      prNumber,
      headSha,
      finalBody,
      newComments || []
    );

    const { state, description } = statusFromVerdict(verdict, failOn);
    await setStatus(
      octokit,
      owner,
      repo,
      headSha,
      statusContext,
      state,
      description
    );

    core.info(`Verdict: ${verdict}. Status check: ${state}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.error(`Review failed: ${msg}`);

    await setStatus(
      octokit,
      owner,
      repo,
      headSha,
      statusContext,
      "error",
      truncate(msg, 140)
    ).catch(() => {});
    core.setFailed(`Jules PR review failed: ${msg}`);
  }
}

function truncateDiff(
  diff: string,
  maxChars: number
): { text: string; truncatedNote?: string } {
  if (diff.length <= maxChars) return { text: diff };
  const text = diff.slice(0, maxChars);
  return {
    text,
    truncatedNote: `The diff was truncated: original ${diff.length} chars, kept first ${maxChars}. Some changes are not visible in the diff above; your review of the visible portion should state this caveat.`,
  };
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function statusFromVerdict(
  verdict: Verdict,
  failOn: FailOn
): { state: "success" | "failure"; description: string } {
  if (failOn === "never") {
    return {
      state: "success",
      description: `Review complete (verdict: ${verdict})`,
    };
  }
  if (failOn === "any") {
    return verdict === "approve"
      ? { state: "success", description: "Approved" }
      : { state: "failure", description: `Review verdict: ${verdict}` };
  }
  return verdict === "block"
    ? { state: "failure", description: "Blocking issues found" }
    : {
        state: "success",
        description: `Review complete (verdict: ${verdict})`,
      };
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
