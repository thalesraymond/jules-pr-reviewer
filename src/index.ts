import * as core from "@actions/core";
import * as github from "@actions/github";
import { FailOn, Verdict, ReviewComment } from "./types.js";
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
import { parseIgnoredPaths, filterDiff, getErrorMessage } from "./utils.js";
import { logStructured, setReviewOutputs } from "./logging.js";

const COMMENT_MARKER = "<!-- jules-pr-reviewer -->";
const VALID_FAIL_ON: FailOn[] = ["never", "blocking", "any"];

async function run(): Promise<void> {
  const reviewStartTime = Date.now();

  const apiKey = core.getInput("jules_api_key", { required: true });
  core.setSecret(apiKey);
  process.env.JULES_API_KEY = apiKey;

  const token = core.getInput("github_token", { required: true });
  core.setSecret(token);
  process.env.GITHUB_TOKEN = token;

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
  const ignoredPathsRaw = core.getInput("ignored_paths");
  const ignoredPaths = parseIgnoredPaths(ignoredPathsRaw);
  const timeoutMinutesRaw = core.getInput("timeout_minutes") || "30";
  const timeoutMinutes = Math.max(1, parseInt(timeoutMinutesRaw, 10) || 30);
  const enableSuggestions = core.getBooleanInput("enable_suggestions");

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

  // Emit review_started
  logStructured("review_started", {
    repoOwner: owner,
    repoName: repo,
    prNumber,
    headSha,
  });

  // ⚡ Bolt: Optimize bypass label check to stop iterating early and prevent wasteful `.map` array allocation
  const hasBypassLabel = (pr.labels || []).some(
    (l: { name: string }) => l.name === bypassLabel
  );

  if (isDraft && skipDrafts) {
    core.info("Skipping draft PR.");
    setReviewOutputs({
      verdict: "skipped",
      issues_count: 0,
      high_issues_count: 0,
      warning_issues_count: 0,
      info_issues_count: 0,
    });
    return;
  }
  if (isFork && skipForks) {
    core.info("Skipping fork PR (skip_forks=true).");
    setReviewOutputs({
      verdict: "skipped",
      issues_count: 0,
      high_issues_count: 0,
      warning_issues_count: 0,
      info_issues_count: 0,
    });
    return;
  }
  if (hasBypassLabel) {
    core.info(`Bypass label "${bypassLabel}" present — skipping review.`);
    setReviewOutputs({
      verdict: "skipped",
      issues_count: 0,
      high_issues_count: 0,
      warning_issues_count: 0,
      info_issues_count: 0,
    });
    return;
  }

  // ⚡ Bolt: Delay instantiating the Octokit client until after early returns (draft/fork/bypass) to save memory
  const octokit = github.getOctokit(token);

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

    // ⚡ Bolt: Execute independent GitHub API calls concurrently to reduce overall latency
    const [diff, rulesFromFile, openThreads] = await Promise.all([
      fetchDiff(octokit, owner, repo, pr, baseShaForDiff, headSha),
      rulesFilePath
        ? loadRulesFromBase(octokit, owner, repo, rulesFilePath, baseSha)
        : Promise.resolve(undefined),
      fetchOpenThreads(octokit, owner, repo, prNumber),
    ]);

    const filteredDiff = filterDiff(diff, ignoredPaths);
    const { text: diffText, truncatedNote } = truncateDiff(
      filteredDiff,
      80_000
    );

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

    const julesApiCallStart = Date.now();
    const { reviewResult, sessionId } = await runJulesReview(
      apiKey,
      prompt,
      { github: `${owner}/${repo}`, baseBranch: pr.base.ref },
      timeoutMinutes
    );
    const julesApiDuration = Date.now() - julesApiCallStart;
    logStructured("jules_api_called", {
      success: true,
      duration: julesApiDuration,
    });

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
      logStructured("review_failed", {
        reason: "No valid review returned",
        stage: "api_response",
      });
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

    const commentsForReview: ReviewComment[] = (newComments || []).map((c) => {
      const copy = { ...c };
      if (!enableSuggestions) {
        delete copy.suggestion;
        delete copy.startLine;
      }
      return copy;
    });

    await submitReview(
      octokit,
      owner,
      repo,
      prNumber,
      headSha,
      finalBody,
      commentsForReview
    );

    logStructured("review_submitted", {
      verdict,
      sessionId,
      commentCount: commentsForReview.length,
    });

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

    // Compute issue counts from newComments
    const highCount = (newComments || []).filter(
      (c) => c.severity === "High"
    ).length;
    const warningCount = (newComments || []).filter(
      (c) => c.severity === "Warning"
    ).length;
    const infoCount = (newComments || []).filter(
      (c) => c.severity === "Info"
    ).length;

    const reviewDuration = Date.now() - reviewStartTime;
    setReviewOutputs({
      verdict: verdict as "approve" | "comment" | "block",
      issues_count: (newComments || []).length,
      high_issues_count: highCount,
      warning_issues_count: warningCount,
      info_issues_count: infoCount,
      session_id: sessionId,
    });

    logStructured("review_completed", {
      verdict,
      issuesCount: (newComments || []).length,
      highIssues: highCount,
      warningIssues: warningCount,
      infoIssues: infoCount,
      sessionId,
      duration: reviewDuration,
    });

    core.info(`Verdict: ${verdict}. Status check: ${state}.`);
  } catch (err) {
    const msg = getErrorMessage(err);
    core.error(`Review failed: ${msg}`);

    logStructured("review_failed", {
      reason: msg,
      stage: "review_execution",
    });

    setReviewOutputs({
      verdict: "skipped",
      issues_count: 0,
      high_issues_count: 0,
      warning_issues_count: 0,
      info_issues_count: 0,
    });

    await setStatus(
      octokit,
      owner,
      repo,
      headSha,
      statusContext,
      "error",
      "Review failed. Check GitHub Actions log for details."
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

export function statusFromVerdict(
  verdict: Verdict,
  failOn: FailOn
): { state: "success" | "failure"; description: string } {
  if (!["approve", "comment", "block"].includes(verdict)) {
    return {
      state: "failure",
      description: "Invalid review verdict",
    };
  }

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
  core.setFailed(getErrorMessage(err));
});
