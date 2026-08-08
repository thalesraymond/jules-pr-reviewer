import * as core from "@actions/core";
import type { SourceInput } from "@google/jules-sdk";
import { runSession, isAuthError } from "./session.js";
import { ReviewResult } from "./types.js";
import { getErrorMessage } from "./errors.js";
import { logStructured } from "./logging.js";

export async function runJulesReview(
  apiKey: string,
  prompt: string,
  source: SourceInput,
  timeoutMinutes: number
): Promise<{ reviewResult: ReviewResult | null; sessionId: string }> {
  let firstSessionId = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const outcome = await runSession({
      apiKey,
      prompt,
      source,
      title: "Code Review",
      timeoutMinutes,
    });

    if (outcome.kind === "creation_failed") {
      throw outcome.error;
    }

    if (outcome.kind === "review") {
      return {
        reviewResult: outcome.reviewResult,
        sessionId: outcome.sessionId,
      };
    }

    // Timeout on this attempt
    if (attempt === 1) {
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
        `Jules did not respond: session ${firstSessionId} and retry session ${outcome.sessionId} both timed out within ${timeoutMinutes} minutes each.`
      );
      return { reviewResult: null, sessionId: outcome.sessionId };
    }
  }

  // Unreachable — loop always returns or throws, but TypeScript needs it
  throw new Error("Unexpected: retry loop exhausted without returning");
}

export interface AgenticReviewResult {
  reviewResult: ReviewResult | null;
  sessionId: string;
  fallback: boolean;
  fallbackReason?: "session_creation_failed" | "timeout";
}

export async function runAgenticReview(
  apiKey: string,
  prompt: string,
  source: SourceInput,
  timeoutMinutes: number,
  actualChangedFiles?: string[]
): Promise<AgenticReviewResult> {
  const outcome = await runSession({
    apiKey,
    prompt,
    source,
    title: "Code Review (Agentic)",
    timeoutMinutes,
  });

  if (outcome.kind === "creation_failed") {
    const msg = getErrorMessage(outcome.error);
    core.warning(`Agentic session creation failed: ${msg}`);
    logStructured("agentic_fallback", {
      reason: "session_creation_failed",
      error: msg,
    });
    return {
      reviewResult: null,
      sessionId: "",
      fallback: true,
      fallbackReason: "session_creation_failed",
    };
  }

  if (outcome.kind === "timeout") {
    core.info(`Agentic session ${outcome.sessionId} timed out.`);
    logStructured("agentic_fallback", { reason: "timeout" });
    return {
      reviewResult: null,
      sessionId: outcome.sessionId,
      fallback: true,
      fallbackReason: "timeout",
    };
  }

  // changedFiles verification — informational only. A mismatch between the
  // files Jules reports and the actual changed files is logged and surfaced
  // to the user, but never triggers a fallback or a retry.
  if (actualChangedFiles) {
    const reported = outcome.reviewResult.changedFiles ?? [];
    const result = verifyChangedFiles(reported, actualChangedFiles);

    if (!result.ok) {
      core.warning(
        `changedFiles mismatch: ${result.reason} (reported: ${reported.length}, actual: ${actualChangedFiles.length})`
      );
      logStructured("verification_mismatch", {
        tier: result.reason,
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
  }

  return {
    reviewResult: outcome.reviewResult,
    sessionId: outcome.sessionId,
    fallback: false,
  };
}

function verifyChangedFiles(
  reported: string[],
  actual: string[]
): { ok: true } | { ok: false; reason: "empty" | "partial" } {
  if (reported.length === 0) {
    return { ok: false, reason: "empty" };
  }

  const reportedSet = new Set(reported);
  const missingActual = actual.some((f) => !reportedSet.has(f));

  if (missingActual) {
    return { ok: false, reason: "partial" };
  }

  return { ok: true };
}

export function wrapPermissionError(
  err: unknown,
  needed: string,
  op: string
): Error {
  const msg = getErrorMessage(err);
  if (isAuthError(msg) || msg.includes("Resource not accessible")) {
    return new Error(
      `${op} failed with 403. The github_token likely lacks ${needed}. Add to your workflow:\n` +
        "    permissions:\n      pull-requests: write\n      contents: read\n      checks: write\n" +
        `(original: ${msg})`
    );
  }
  return err instanceof Error ? err : new Error(msg);
}
