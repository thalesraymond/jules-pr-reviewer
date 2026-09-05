import * as core from "@actions/core";
import * as github from "@actions/github";
import { ReviewOutputs } from "./types.js";
import { createCheckRun, finalizeCheckRun } from "./github.js";
import { wrapPermissionError } from "./jules.js";
import { evaluateSkipPolicy } from "./skipPolicy.js";
import { prepareDiff } from "./prepareDiff.js";
import { executeReview } from "./executeReview.js";
import { submitResults } from "./submitResults.js";
import {
  getErrorMessage,
  classifyFailure,
  timeoutExitSummary,
} from "./errors.js";
import { loadConfig } from "./config.js";
import { logStructured, setReviewOutputs } from "./logging.js";

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

  try {
    core.setSecret(core.getInput("jules_api_key"));
    core.setSecret(core.getInput("github_token"));
  } catch {
    // Ignore if not present, loadConfig will fail appropriately.
  }

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

  // Emit review_started
  logStructured("review_started", {
    repoOwner: owner,
    repoName: repo,
    prNumber,
    headSha,
  });

  const skipDecision = evaluateSkipPolicy(pr, config, `${owner}/${repo}`);
  if (skipDecision.skip) {
    skipReview(skipDecision.reason ?? "Skipping review.");
    return;
  }
  if (skipDecision.warning) {
    core.warning(skipDecision.warning);
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
    const {
      diff: filteredDiff,
      changedFiles,
      rulesFromFile,
      perPathRules,
      openThreads,
    } = await prepareDiff(
      octokit,
      owner,
      repo,
      prNumber,
      diffBaseForMode,
      baseSha,
      headSha,
      {
        ignoredPaths: config.ignoredPaths,
        rulesFilePath: config.rulesFilePath,
        rulesDirectory: config.rulesDirectory,
      }
    );

    const { reviewResult, sessionId, reviewCoverage, julesApiDuration } =
      await executeReview(
        config.apiKey,
        prNumber,
        {
          title: pr.title,
          body: pr.body,
          head: pr.head,
          base: pr.base,
        },
        {
          diff: filteredDiff,
          changedFiles,
          rulesFromFile,
          perPathRules,
          openThreads,
        },
        `${owner}/${repo}`,
        baseSha,
        headSha,
        {
          diffMode: config.diffMode,
          ignoredPaths: config.ignoredPaths,
          extraInstructions: config.extraInstructions,
          dedupe: config.dedupe,
          strictness: config.strictness,
          largePrThreshold: config.largePrThreshold,
          largePrStrategy: config.largePrStrategy,
          timeoutMinutes: config.timeoutMinutes,
        }
      );

    if (julesApiDuration !== undefined) {
      logStructured("jules_api_called", {
        success: true,
        duration: julesApiDuration,
      });
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

    await submitResults(
      octokit,
      owner,
      repo,
      prNumber,
      headSha,
      checkRunId!,
      reviewResult,
      reviewCoverage,
      openThreads,
      sessionId,
      {
        enableSuggestions: config.enableSuggestions,
        enableApprove: config.enableApprove,
        minSeverityToReport: config.minSeverityToReport,
        strictness: config.strictness,
        blockOn: config.blockOn,
        failOn: config.failOn,
        statusContext: config.statusContext,
      },
      reviewStartTime
    );
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

run().catch((err) => {
  core.setFailed(getErrorMessage(err));
});
