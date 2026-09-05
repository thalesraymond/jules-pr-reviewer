import * as core from "@actions/core";
import { buildReviewPrompt } from "./prompt.js";
import { runJulesReview, runAgenticReview } from "./jules.js";
import { preparePromptDiff } from "./coverage.js";
import { logStructured } from "./logging.js";
import {
  DiffMode,
  LargePrStrategy,
  ReviewResult,
  ReviewCoverage,
  Strictness,
  PathRuleFile,
  OpenThread,
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
};

export type PreparedDiffForReview = {
  diff: string;
  changedFiles: string[];
  rulesFromFile?: string;
  perPathRules: PathRuleFile[];
  openThreads: OpenThread[];
};

export type ReviewExecutionResult = {
  reviewResult: ReviewResult | null;
  sessionId: string;
  reviewCoverage?: ReviewCoverage;
  julesApiDuration?: number;
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
  prepared: PreparedDiffForReview,
  ownerRepo: string,
  baseSha: string,
  headSha: string,
  config: ExecuteReviewConfig
): Promise<ReviewExecutionResult> {
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
      agenticPrompt,
      { github: ownerRepo, baseBranch: pr.head.ref },
      config.timeoutMinutes,
      prepared.changedFiles
    );

    if (!agentic.fallback && agentic.reviewResult) {
      if (agentic.reviewResult.changedFiles) {
        core.info(
          `Jules reported reviewing ${agentic.reviewResult.changedFiles.length} files: ${JSON.stringify(agentic.reviewResult.changedFiles)}`
        );
      }
      return {
        reviewResult: agentic.reviewResult,
        sessionId: agentic.sessionId,
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

  const julesApiCallStart = Date.now();
  const promptResult = await runJulesReview(
    apiKey,
    prompt,
    { github: ownerRepo, baseBranch: pr.base.ref },
    config.timeoutMinutes
  );
  const julesApiDuration = Date.now() - julesApiCallStart;
  logStructured("jules_api_called", {
    success: true,
    duration: julesApiDuration,
  });

  return {
    reviewResult: promptResult.reviewResult,
    sessionId: promptResult.sessionId,
    reviewCoverage: promptDiff.coverage,
    julesApiDuration,
  };
}
