import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  FailOn,
  Verdict,
  Severity,
  ReviewComment,
  ReviewResult,
  ReviewCoverage,
  ReviewOutputs,
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
  parseListInput,
  parseIgnoredPaths,
  filterDiff,
  extractChangedFilePaths,
} from "./filtering.js";
import {
  shouldIgnoreTitle,
  shouldIgnoreAuthor,
  evaluateLabelPolicy,
} from "./ignore.js";
import { filterCommentsBySeverity, hasFindingsAtOrAbove } from "./severity.js";
import { preparePromptDiff, buildPostedCoverageNote } from "./coverage.js";
import {
  getErrorMessage,
  classifyFailure,
  timeoutExitSummary,
} from "./errors.js";
import { loadConfig } from "./config.js";
import { logStructured, setReviewOutputs } from "./logging.js";

const COMMENT_MARKER = "<!-- jules-pr-reviewer -->";

const SKIPPED_OUTPUTS: ReviewOutputs = {
  verdict: "skipped",
  issues_count: 0,
  high_issues_count: 0,
  warning_issues_count: 0,
  info_issues_count: 0,
};

function skipReview(message: string): void {
  core.info(message);
  setReviewOutputs(SKIPPED_OUTPUTS);
}

function failWithConfigError(reason: string): void {
  logStructured("review_failed", {
    reason,
    stage: "config",
    kind: "config",
  });
  core.setFailed(reason);
}

async function run(): Promise<void> {
  const reviewStartTime = Date.now();

  const configResult = loadConfig(core);
  if (!configResult.ok) {
    failWithConfigError(configResult.error);
    return;
  }
  const config = configResult.config;

  const ctx = github.context;
  if (ctx.eventName === "pull_request_target") {
    failWithConfigError(
      "pull_request_target is not supported — it runs with base-repo write tokens and exposes the action to prompt-injection via attacker-controlled diffs. Use on: pull_request instead."
    );
    return;
  }
  if (ctx.eventName !== "pull_request") {
    failWithConfigError(
      `Unsupported event: ${ctx.eventName}. Use on: pull_request.`
    );
    return;
  }

  const pr = ctx.payload.pull_request;
  if (!pr) {
    failWithConfigError("No pull_request payload found.");
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
    skipReview("Skipping draft PR.");
    return;
  }
  if (isFork && config.skipForks) {
    skipReview("Skipping fork PR (skip_forks=true).");
    return;
  }
  if (hasBypassLabel) {
    skipReview(
      `Bypass label "${config.bypassLabel}" present — skipping review.`
    );
    return;
  }

  const ignoreTitleKeywords = parseListInput(config.ignoreTitleKeywords);
  if (shouldIgnoreTitle(pr.title || "", ignoreTitleKeywords)) {
    skipReview(
      "PR title matches an ignore_title_keywords entry — skipping review."
    );
    return;
  }

  const ignoreAuthors = parseListInput(config.ignoreAuthors);
  if (shouldIgnoreAuthor(pr.user?.login, ignoreAuthors)) {
    skipReview(
      `PR author "${pr.user?.login}" is in ignore_authors — skipping review.`
    );
    return;
  }

  const reviewLabels = parseListInput(config.reviewLabels);
  if (reviewLabels.length > 0) {
    const labelDecision = evaluateLabelPolicy(pr.labels, reviewLabels);
    if (!labelDecision.evaluable) {
      core.warning(
        labelDecision.reason ??
          "review_labels cannot be evaluated for this event — continuing the review."
      );
    } else if (labelDecision.skip) {
      skipReview(
        labelDecision.reason ?? "review_labels matched — skipping review."
      );
      return;
    }
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
    let reviewCoverage: ReviewCoverage | undefined;

    if (config.diffMode === "agentic") {
      const isLarge = filteredDiff.length > config.largePrThreshold;
      const largePrCoverage: ReviewCoverage | undefined = isLarge
        ? { isLarge: true, totalFiles: new Set(changedFiles).size }
        : undefined;

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
        largePrCoverage,
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
      const prepared = preparePromptDiff(
        filteredDiff,
        config.largePrThreshold,
        config.largePrStrategy
      );
      reviewCoverage = prepared.coverage;

      const prompt = buildReviewPrompt({
        mode: "prompt",
        repoFullName: `${owner}/${repo}`,
        prNumber,
        prTitle: pr.title || "",
        prBody: pr.body || "",
        diff: prepared.diff,
        diffTruncatedNote: prepared.diffTruncatedNote,
        largePrCoverage: prepared.coverage,
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
        summary: timeoutExitSummary(config.timeoutMinutes),
      });
      logStructured("review_failed", {
        reason: "No valid review returned",
        stage: "timeout",
        kind: "timeout",
      });
      core.setFailed(
        `Jules returned no review message within ${config.timeoutMinutes} minutes.`
      );
      return;
    }

    const { verdict, summary, resolvedCommentIds, newComments, unparseable } =
      reviewResult;
    const reportedComments = filterCommentsBySeverity(
      newComments || [],
      config.minSeverityToReport
    );

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
    const coverageNote = buildPostedCoverageNote(reviewCoverage);
    const finalBody = `${COMMENT_MARKER}\n## 🤖 Jules Review\n\n${summary}${
      coverageNote ? `\n\n${coverageNote}` : ""
    }\n\n---\n_Session: \`${sessionId}\`_`;

    const commentsForReview: ReviewComment[] = reportedComments.map((c) => {
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
      commentCount: reportedComments.length,
    });

    const { conclusion, description } = unparseable
      ? {
          conclusion: "failure" as const,
          description:
            "Jules returned a response that could not be parsed as a review.",
        }
      : config.blockOn
        ? conclusionFromFindings(reportedComments, config.blockOn)
        : conclusionFromVerdict(verdict, config.failOn);
    const annotations = buildAnnotations(reportedComments);
    await finalizeCheckRun(octokit, owner, repo, checkRunId!, conclusion, {
      title: "Jules Review",
      summary: description,
      ...(annotations.length > 0 ? { annotations } : {}),
    });

    // Compute issue counts from reportedComments
    const highCount = reportedComments.filter(
      (c) => c.severity === "High"
    ).length;
    const warningCount = reportedComments.filter(
      (c) => c.severity === "Warning"
    ).length;
    const infoCount = reportedComments.filter(
      (c) => c.severity === "Info"
    ).length;

    const reviewDuration = Date.now() - reviewStartTime;
    setReviewOutputs({
      verdict: verdict as "approve" | "comment" | "block",
      issues_count: reportedComments.length,
      high_issues_count: highCount,
      warning_issues_count: warningCount,
      info_issues_count: infoCount,
      session_id: sessionId,
    });

    logStructured("review_completed", {
      verdict,
      issuesCount: reportedComments.length,
      highIssues: highCount,
      warningIssues: warningCount,
      infoIssues: infoCount,
      sessionId,
      duration: reviewDuration,
      ...(reviewCoverage
        ? {
            coverage: {
              reviewedFiles: reviewCoverage.reviewedFiles,
              totalFiles: reviewCoverage.totalFiles,
              excludedCount: (reviewCoverage.excludedFiles ?? []).length,
            },
          }
        : {}),
    });

    core.info(`Verdict: ${verdict}. Check run conclusion: ${conclusion}.`);
  } catch (err) {
    const failure = classifyFailure(err);
    core.error(`Review failed: ${failure.message}`);

    logStructured("review_failed", {
      reason: failure.message,
      stage: failure.stage,
      kind: failure.kind,
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
        summary: failure.summary,
      }).catch(() => {});
    }
    core.setFailed(`Jules PR review failed: ${failure.message}`);
  }
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

export function conclusionFromFindings(
  comments: ReviewComment[],
  blockOn: Severity
): { conclusion: "success" | "failure"; description: string } {
  return hasFindingsAtOrAbove(comments, blockOn)
    ? {
        conclusion: "failure",
        description: `Findings at or above ${blockOn.toLowerCase()} severity found`,
      }
    : {
        conclusion: "success",
        description: `No findings at or above ${blockOn.toLowerCase()} severity`,
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
