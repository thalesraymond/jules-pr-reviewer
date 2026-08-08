import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  FailOn,
  Verdict,
  ReviewComment,
  ReviewResult,
  CheckRunAnnotation,
} from "./types.js";
import {
  fetchDiff,
  loadRulesFromBase,
  fetchOpenThreads,
  resolveThreads,
  createCheckRun,
  finalizeCheckRun,
} from "./github.js";
import { submitReview } from "./submission.js";
import {
  runJulesReview,
  runAgenticReview,
  wrapPermissionError,
} from "./jules.js";
import { buildReviewPrompt } from "./prompt.js";
import {
  parseIgnoredPaths,
  filterDiff,
  extractChangedFilePaths,
} from "./filtering.js";
import { getErrorMessage } from "./errors.js";
import { loadConfig } from "./config.js";
import { logStructured, setReviewOutputs } from "./logging.js";

const COMMENT_MARKER = "<!-- jules-pr-reviewer -->";

async function run(): Promise<void> {
  const reviewStartTime = Date.now();

  const configResult = loadConfig(core);
  if (!configResult.ok) {
    core.setFailed(configResult.error);
    return;
  }
  const config = configResult.config;

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
    (l: { name: string }) => l.name === config.bypassLabel
  );

  if (isDraft && config.skipDrafts) {
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
  if (isFork && config.skipForks) {
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
    core.info(
      `Bypass label "${config.bypassLabel}" present — skipping review.`
    );
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
  const octokit = github.getOctokit(config.token);

  let checkRunId: number | undefined;
  try {
    try {
      checkRunId = await createCheckRun(
        octokit,
        owner,
        repo,
        config.statusContext,
        headSha
      );
    } catch (err) {
      throw wrapPermissionError(err, "checks:write", "createCheckRun");
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

    // In agentic mode Jules inspects the full base...head diff, so use baseSha
    // for the changed-file set regardless of synchronize events.
    const diffBaseForMode =
      config.diffMode === "agentic" ? baseSha : baseShaForDiff;

    // ⚡ Bolt: Execute independent GitHub API calls concurrently to reduce overall latency
    const [diff, rulesFromFile, openThreads] = await Promise.all([
      fetchDiff(octokit, owner, repo, pr, diffBaseForMode, headSha),
      config.rulesFilePath
        ? loadRulesFromBase(octokit, owner, repo, config.rulesFilePath, baseSha)
        : Promise.resolve(undefined),
      fetchOpenThreads(octokit, owner, repo, prNumber),
    ]);

    const filteredDiff = filterDiff(
      diff,
      parseIgnoredPaths(config.ignoredPaths)
    );
    const changedFiles = extractChangedFilePaths(filteredDiff);

    let reviewResult: ReviewResult | null = null;
    let sessionId = "";

    if (config.diffMode === "agentic") {
      const agenticPrompt = buildReviewPrompt({
        mode: "agentic",
        repoFullName: `${owner}/${repo}`,
        prNumber,
        prTitle: pr.title || "",
        prBody: pr.body || "",
        baseSha,
        headSha,
        ignoredPaths: config.ignoredPaths,
        extraInstructions: config.extraInstructions,
        rulesFromFile,
        openThreads,
        dedupe: config.dedupe,
        fileCount: changedFiles.length,
      });

      const agentic = await runAgenticReview(
        config.apiKey,
        agenticPrompt,
        { github: `${owner}/${repo}`, baseBranch: pr.head.ref },
        config.timeoutMinutes,
        changedFiles
      );
      sessionId = agentic.sessionId;

      if (!agentic.fallback) {
        reviewResult = agentic.reviewResult;
        if (reviewResult?.changedFiles) {
          core.info(
            `Jules reported reviewing ${reviewResult.changedFiles.length} files: ${JSON.stringify(reviewResult.changedFiles)}`
          );
        }
      }
    }

    if (reviewResult === null) {
      const { text: diffText, truncatedNote } = truncateDiff(
        filteredDiff,
        80_000
      );

      const prompt = buildReviewPrompt({
        mode: "prompt",
        repoFullName: `${owner}/${repo}`,
        prNumber,
        prTitle: pr.title || "",
        prBody: pr.body || "",
        diff: diffText,
        diffTruncatedNote: truncatedNote,
        extraInstructions: config.extraInstructions,
        rulesFromFile,
        openThreads,
        dedupe: config.dedupe,
      });

      const julesApiCallStart = Date.now();
      const promptResult = await runJulesReview(
        config.apiKey,
        prompt,
        { github: `${owner}/${repo}`, baseBranch: pr.base.ref },
        config.timeoutMinutes
      );
      const julesApiDuration = Date.now() - julesApiCallStart;
      logStructured("jules_api_called", {
        success: true,
        duration: julesApiDuration,
      });
      reviewResult = promptResult.reviewResult;
      sessionId = promptResult.sessionId;
    }

    if (!reviewResult) {
      await finalizeCheckRun(octokit, owner, repo, checkRunId!, "failure", {
        title: "Jules Review",
        summary: "Jules did not return a valid review in time",
      });
      logStructured("review_failed", {
        reason: "No valid review returned",
        stage: "api_response",
      });
      core.setFailed(
        `Jules returned no review message within ${config.timeoutMinutes} minutes.`
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
      if (!config.enableSuggestions) {
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

    const { conclusion, description } = conclusionFromVerdict(
      verdict,
      config.failOn
    );
    const annotations = buildAnnotations(newComments || []);
    await finalizeCheckRun(octokit, owner, repo, checkRunId!, conclusion, {
      title: "Jules Review",
      summary: description,
      ...(annotations.length > 0 ? { annotations } : {}),
    });

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

    core.info(`Verdict: ${verdict}. Check run conclusion: ${conclusion}.`);
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

    if (checkRunId !== undefined) {
      await finalizeCheckRun(octokit, owner, repo, checkRunId, "failure", {
        title: "Jules Review",
        summary: "Review failed. Check GitHub Actions log for details.",
      }).catch(() => {});
    }
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

export function conclusionFromVerdict(
  verdict: Verdict,
  failOn: FailOn
): { conclusion: "success" | "failure"; description: string } {
  if (!["approve", "comment", "block"].includes(verdict)) {
    return {
      conclusion: "failure",
      description: "Invalid review verdict",
    };
  }

  if (failOn === "never") {
    return {
      conclusion: "success",
      description: `Review complete (verdict: ${verdict})`,
    };
  }
  if (failOn === "any") {
    return verdict === "approve"
      ? { conclusion: "success", description: "Approved" }
      : { conclusion: "failure", description: `Review verdict: ${verdict}` };
  }
  return verdict === "block"
    ? { conclusion: "failure", description: "Blocking issues found" }
    : {
        conclusion: "success",
        description: `Review complete (verdict: ${verdict})`,
      };
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

run().catch((err) => {
  core.setFailed(getErrorMessage(err));
});
