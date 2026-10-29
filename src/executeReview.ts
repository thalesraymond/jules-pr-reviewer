import * as core from "@actions/core";
import type { SourceInput } from "@google/jules-sdk";
import { buildReviewPrompt } from "./prompt.js";
import { runSession } from "./session.js";
import { getErrorMessage, QuotaExceededError, AuthError } from "./errors.js";
import type { ReusableSession } from "./sessionReuse.js";
import { preparePromptDiff } from "./coverage.js";
import { logStructured } from "./logging.js";
import type { PreparedDiff } from "./reviewPreparation.js";
import {
  DiffMode,
  LargePrStrategy,
  ReviewResult,
  ReviewCoverage,
  Strictness,
} from "./types.js";

export type ExecuteReviewConfig = {
  diffMode: DiffMode;
  ignoredPaths?: string;
  extraInstructions?: string;
  dedupe: boolean;
  strictness: Strictness;
  largePrThreshold: number;
  largePrStrategy: LargePrStrategy;
  timeoutMinutes: number;
  reusableSession?: ReusableSession;
};

export type ReviewExecutionResult = {
  reviewResult: ReviewResult | null;
  sessionId: string;
  sessionFollowups?: number;
  sessionMode?: DiffMode;
  reviewCoverage?: ReviewCoverage;
};

export async function executeReview(
  apiKey: string,
  prNumber: number,
  pr: {
    title?: string;
    body?: string;
    head: { ref: string };
    base: { ref: string };
  },
  prepared: PreparedDiff,
  ownerRepo: string,
  baseSha: string,
  headSha: string,
  config: ExecuteReviewConfig
): Promise<ReviewExecutionResult> {
  const executionStart = Date.now();
  let success = false;
  try {
    const commonPromptArgs = {
      repoFullName: ownerRepo,
      prNumber,
      prTitle: pr.title ?? "",
      prBody: pr.body ?? "",
      extraInstructions: config.extraInstructions,
      rulesFromFile: prepared.rulesFromFile,
      perPathRules: prepared.perPathRules,
      openThreads: prepared.openThreads,
      dedupe: config.dedupe,
      strictness: config.strictness,
    };

    if (config.diffMode === "agentic") {
      const isLarge = prepared.diff.length > config.largePrThreshold;
      const largePrCoverage: ReviewCoverage | undefined = isLarge
        ? { isLarge: true, totalFiles: new Set(prepared.changedFiles).size }
        : undefined;

      const agenticPrompt = buildReviewPrompt({
        mode: "agentic",
        ...commonPromptArgs,
        baseSha,
        headSha,
        ignoredPaths: config.ignoredPaths,
        largePrCoverage,
      });

      const agentic = await runAgenticReview(
        apiKey,
        config.reusableSession
          ? `Before reviewing, refresh the repository checkout to the current PR head, not the previous review's checkout. Run git fetch origin ${baseSha} ${headSha}, then git checkout --detach ${headSha}. If either fails, report the failure; do not review the stale checkout.\n\n${agenticPrompt}`
          : agenticPrompt,
        { github: ownerRepo, baseBranch: pr.head.ref },
        config.timeoutMinutes,
        prepared.changedFiles,
        config.reusableSession
      );

      if (agentic) {
        success = !agentic.reviewResult.unparseable;
        if (agentic.reviewResult.changedFiles) {
          core.info(
            `Jules reported reviewing ${agentic.reviewResult.changedFiles.length} files: ${JSON.stringify(agentic.reviewResult.changedFiles)}`
          );
        }
        return {
          reviewResult: agentic.reviewResult,
          sessionId: agentic.sessionId,
          ...(agentic.sessionFollowups !== undefined
            ? { sessionFollowups: agentic.sessionFollowups }
            : {}),
        };
      }
    }

    const promptDiff = preparePromptDiff(
      prepared.diff,
      config.largePrThreshold,
      config.largePrStrategy
    );

    const prompt = buildReviewPrompt({
      mode: "prompt",
      ...commonPromptArgs,
      diff: promptDiff.diff,
      diffTruncatedNote: promptDiff.diffTruncatedNote,
      largePrCoverage: promptDiff.coverage,
    });

    const promptResult = await runJulesReview(
      apiKey,
      prompt,
      { github: ownerRepo, baseBranch: pr.base.ref },
      config.timeoutMinutes,
      config.diffMode === "prompt" ? config.reusableSession : undefined,
      config.diffMode === "agentic" && config.reusableSession ? 1 : 2
    );
    success =
      promptResult.reviewResult !== null &&
      !promptResult.reviewResult.unparseable;

    return {
      reviewResult: promptResult.reviewResult,
      sessionId: promptResult.sessionId,
      ...(promptResult.sessionFollowups !== undefined
        ? { sessionFollowups: promptResult.sessionFollowups }
        : {}),
      reviewCoverage: promptDiff.coverage,
      ...(config.diffMode === "agentic"
        ? { sessionMode: "prompt" as const }
        : {}),
    };
  } finally {
    logStructured("jules_api_called", {
      success,
      duration: Date.now() - executionStart,
    });
  }
}

async function runJulesReview(
  apiKey: string,
  prompt: string,
  source: SourceInput,
  timeoutMinutes: number,
  reusableSession?: ReusableSession,
  maxAttempts = 2
): Promise<ReviewExecutionResult> {
  let firstSessionId = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await runSession({
      apiKey,
      prompt,
      source,
      title: "Code Review",
      timeoutMinutes,
      ...(attempt === 1 && reusableSession ? { reusableSession } : {}),
    });

    if (outcome.kind === "creation_failed") {
      if (
        attempt === 1 &&
        reusableSession &&
        !(outcome.error instanceof QuotaExceededError) &&
        !(outcome.error instanceof AuthError)
      ) {
        core.warning(
          `Session reuse failed; starting fresh: ${getErrorMessage(outcome.error)}`
        );
        continue;
      }
      throw outcome.error;
    }

    if (outcome.kind === "review") {
      if (attempt === 1 && reusableSession && outcome.reviewResult.unparseable)
        continue;
      return {
        reviewResult: outcome.reviewResult,
        sessionId: outcome.sessionId,
        ...(outcome.sessionFollowups !== undefined
          ? { sessionFollowups: outcome.sessionFollowups }
          : {}),
      };
    }

    if (attempt < maxAttempts) {
      core.info(
        `Jules session ${outcome.sessionId} timed out. Retrying with a fresh session…`
      );
      core.info(
        JSON.stringify({
          event: "jules_retry",
          failedSessionId: outcome.sessionId,
          attempt: 1,
        })
      );
      firstSessionId = outcome.sessionId;
    } else {
      core.error(
        firstSessionId
          ? `Jules did not respond: session ${firstSessionId} and retry session ${outcome.sessionId} both timed out within ${timeoutMinutes} minutes each.`
          : `Jules session ${outcome.sessionId} timed out within ${timeoutMinutes} minutes.`
      );
      return { reviewResult: null, sessionId: outcome.sessionId };
    }
  }

  throw new Error("Unexpected: retry loop exhausted without returning");
}

async function runAgenticReview(
  apiKey: string,
  prompt: string,
  source: SourceInput,
  timeoutMinutes: number,
  actualChangedFiles: string[],
  reusableSession?: ReusableSession
): Promise<{
  reviewResult: ReviewResult;
  sessionId: string;
  sessionFollowups?: number;
} | null> {
  const outcome = await runSession({
    apiKey,
    prompt,
    source,
    title: "Code Review (Agentic)",
    timeoutMinutes,
    ...(reusableSession ? { reusableSession } : {}),
  });

  if (outcome.kind === "creation_failed") {
    if (
      outcome.error instanceof QuotaExceededError ||
      (reusableSession && outcome.error instanceof AuthError)
    ) {
      // A prompt session would fail against the same exhausted quota.
      throw outcome.error;
    }
    const msg = getErrorMessage(outcome.error);
    core.warning(`Agentic session creation failed: ${msg}`);
    logStructured("agentic_fallback", {
      reason: "session_creation_failed",
      error: msg,
    });
    return null;
  }

  if (outcome.kind === "timeout") {
    core.info(`Agentic session ${outcome.sessionId} timed out.`);
    logStructured("agentic_fallback", { reason: "timeout" });
    return null;
  }

  if (reusableSession && outcome.reviewResult.unparseable) {
    logStructured("agentic_fallback", { reason: "reuse_parse_failed" });
    return null;
  }

  // Verification is informational: a mismatch must not discard a valid review.
  const reported = outcome.reviewResult.changedFiles ?? [];
  const reportedSet = new Set(reported);
  const missingActual = actualChangedFiles.some((f) => !reportedSet.has(f));
  const reason =
    reported.length === 0 ? "empty" : missingActual ? "partial" : null;
  if (reason) {
    core.warning(
      `changedFiles mismatch: ${reason} (reported: ${reported.length}, actual: ${actualChangedFiles.length})`
    );
    logStructured("verification_mismatch", {
      tier: reason,
      reportedCount: reported.length,
      actualCount: actualChangedFiles.length,
    });
  } else if (reported.length > actualChangedFiles.length) {
    logStructured("verification_mismatch", {
      tier: "extra_only",
      reportedCount: reported.length,
      actualCount: actualChangedFiles.length,
    });
  }

  return {
    reviewResult: outcome.reviewResult,
    sessionId: outcome.sessionId,
    ...(outcome.sessionFollowups !== undefined
      ? { sessionFollowups: outcome.sessionFollowups }
      : {}),
  };
}
