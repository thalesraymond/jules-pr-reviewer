import * as core from "@actions/core";
import { submitReview, buildAnnotations } from "./submission.js";
import { resolveThreads, finalizeCheckRun } from "./github.js";
import { setReviewOutputs, logStructured } from "./logging.js";
import {
  filterCommentsBySeverity,
  conclusionFromVerdict,
  conclusionFromFindings,
} from "./severity.js";
import { filterCommentsByStrictness } from "./strictness.js";
import { buildPostedCoverageNote } from "./coverage.js";
import {
  ReviewResult,
  ReviewCoverage,
  OpenThread,
  Severity,
  FailOn,
  Strictness,
  ReviewOutputs,
} from "./types.js";

const COMMENT_MARKER = "<!-- jules-pr-reviewer -->";

export type SubmitResultsConfig = {
  enableSuggestions: boolean;
  enableApprove: boolean;
  minSeverityToReport: Severity;
  strictness: Strictness;
  blockOn?: Severity;
  failOn: FailOn;
  statusContext: string;
};

export async function submitResults(
  octokit: ReturnType<typeof import("@actions/github").getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  checkRunId: number,
  reviewResult: ReviewResult,
  reviewCoverage: ReviewCoverage | undefined,
  openThreads: OpenThread[],
  sessionId: string,
  config: SubmitResultsConfig,
  reviewStartTime: number
): Promise<void> {
  const { verdict, summary, resolvedCommentIds, newComments, unparseable } =
    reviewResult;

  const reportedComments = filterCommentsByStrictness(
    filterCommentsBySeverity(newComments || [], config.minSeverityToReport),
    config.strictness
  );

  if (resolvedCommentIds && resolvedCommentIds.length > 0) {
    const threadIdsToResolve = openThreads
      .filter((t) => resolvedCommentIds.includes(t.index))
      .map((t) => t.threadId);

    if (threadIdsToResolve.length > 0) {
      await resolveThreads(octokit, threadIdsToResolve);
    }
  }

  const highCount = reportedComments.filter(
    (c) => c.severity === "High"
  ).length;
  const warningCount = reportedComments.filter(
    (c) => c.severity === "Warning"
  ).length;
  const infoCount = reportedComments.filter(
    (c) => c.severity === "Info"
  ).length;

  const coverageNote = buildPostedCoverageNote(reviewCoverage);
  const countsLine =
    reportedComments.length === 0
      ? "No findings reported."
      : `**Findings:** ${reportedComments.length} (${highCount} High, ${warningCount} Warning, ${infoCount} Info)`;
  const finalBody = `${COMMENT_MARKER}\n## 🤖 Jules Review\n\n${summary}${
    coverageNote ? `\n\n${coverageNote}` : ""
  }\n\n${countsLine}\n\n---\n_Session: \`${sessionId}\`_`;

  const commentsForReview = reportedComments.map((c) => {
    const copy = { ...c };
    if (!config.enableSuggestions) {
      delete copy.suggestion;
      delete copy.startLine;
    }
    return copy;
  });

  const reviewEvent: "COMMENT" | "APPROVE" =
    config.enableApprove && verdict === "approve" ? "APPROVE" : "COMMENT";

  await submitReview(
    octokit,
    owner,
    repo,
    prNumber,
    headSha,
    finalBody,
    commentsForReview,
    reviewEvent
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
  await finalizeCheckRun(octokit, owner, repo, checkRunId, conclusion, {
    title: "Jules Review",
    summary: description,
    ...(annotations.length > 0 ? { annotations } : {}),
  });

  const reviewDuration = Date.now() - reviewStartTime;
  const outputs: ReviewOutputs = {
    verdict: verdict as "approve" | "comment" | "block",
    issues_count: reportedComments.length,
    high_issues_count: highCount,
    warning_issues_count: warningCount,
    info_issues_count: infoCount,
    session_id: sessionId,
  };
  setReviewOutputs(outputs);

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
}
