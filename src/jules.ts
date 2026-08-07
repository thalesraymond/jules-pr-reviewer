import * as core from "@actions/core";
import { jules, type SessionClient } from "@google/jules-sdk";
import { ReviewResult } from "./types.js";
import { parseReviewResponse } from "./validation.js";
import { getErrorMessage } from "./errors.js";
import { logStructured } from "./logging.js";

export async function runJulesReview(
  apiKey: string,
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source: any,
  timeoutMinutes: number
): Promise<{ reviewResult: ReviewResult | null; sessionId: string }> {
  const customJules = jules.with({ apiKey });
  let firstSessionId = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    core.info(`Creating Jules review session (attempt ${attempt}/2)…`);

    const session = await customJules.session({
      prompt,
      source,
      requireApproval: false,
      title: "Code Review",
      autoPr: false,
    });
    core.info(`Jules session: ${session.id}`);

    if (attempt === 1) {
      firstSessionId = session.id;
    }

    await waitUntilSessionReady(session);

    const reviewMessage = await pollForReview(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session as any,
      timeoutMinutes * 60 * 1000
    );
    core.info(`Collected review (${reviewMessage.length} chars)`);

    if (reviewMessage) {
      let reviewResult: ReviewResult;
      try {
        reviewResult = parseJulesResponse(reviewMessage);
      } catch (err) {
        core.error(`Failed to parse Jules response: ${err}`);
        return {
          reviewResult: {
            summary:
              "Jules returned an invalid response that could not be parsed. No valid code review comments are present.",
            verdict: "block",
            resolvedCommentIds: [],
            newComments: [],
          },
          sessionId: session.id,
        };
      }
      return { reviewResult, sessionId: session.id };
    }

    // Timeout on this attempt
    if (attempt === 1) {
      core.info(
        `Jules session ${session.id} timed out. Retrying with a fresh session…`
      );
      core.info(
        JSON.stringify({
          event: "jules_retry",
          failedSessionId: session.id,
          attempt: 1,
        })
      );
      // Continue to attempt 2
    } else {
      // Both attempts timed out
      core.error(
        `Jules did not respond: session ${firstSessionId} and retry session ${session.id} both timed out within ${timeoutMinutes} minutes each.`
      );
      return { reviewResult: null, sessionId: session.id };
    }
  }

  // Unreachable — loop always returns or throws, but TypeScript needs it
  throw new Error("Unexpected: retry loop exhausted without returning");
}

function parseJulesResponse(message: string): ReviewResult {
  return parseReviewResponse(message);
}

async function waitUntilSessionReady(session: {
  id: string;
  info: () => Promise<unknown>;
}): Promise<void> {
  const maxAttempts = 20;
  let delay = 2000;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await session.info();
      core.info(`Session ${session.id} is ready after ${i + 1} attempt(s).`);
      return;
    } catch (err) {
      const msg = getErrorMessage(err);
      if (isAuthError(msg)) {
        throw new Error(
          `Jules API rejected request (${msg}). Check JULES_API_KEY is valid.`,
          { cause: err }
        );
      }
      if (!msg.includes("404")) {
        throw new Error(`Jules session.info() failed: ${msg}`, { cause: err });
      }
      core.info(`Session not yet ready (attempt ${i + 1}/${maxAttempts})…`);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 15000);
    }
  }
  throw new Error("Session did not become ready within timeout.");
}

async function pollForReview(
  session: {
    id: string;
    hydrate: () => Promise<number>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    history: () => AsyncIterable<any>;
  },
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      await session.hydrate();
      let last = "";
      for await (const a of session.history()) {
        if (a.type === "agentMessaged") last = a.message;
      }
      if (last) {
        core.info(`Got agentMessaged on attempt ${attempt}.`);
        return last;
      }
      core.info(`No agentMessaged yet (attempt ${attempt})…`);
    } catch (err) {
      const msg = getErrorMessage(err);
      if (isAuthError(msg)) {
        throw new Error(
          `Jules API rejected request (${msg}). Check JULES_API_KEY is valid.`,
          { cause: err }
        );
      }
      core.info(`hydrate/history error (attempt ${attempt}): ${msg}`);
    }
    await new Promise((r) => setTimeout(r, 20_000));
  }
  return "";
}

export function isAuthError(msg: string): boolean {
  return /\b(?:401|403)\b/.test(msg);
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
        "    permissions:\n      pull-requests: write\n      contents: read\n      statuses: write\n" +
        `(original: ${msg})`
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

export async function archiveSession(session: {
  id: string;
  archive: () => Promise<void>;
}): Promise<void> {
  try {
    await session.archive();
    core.info(`Archived session ${session.id}.`);
  } catch (err) {
    core.warning(
      `Failed to archive session ${session.id}: ${getErrorMessage(err)}`
    );
  }
}

export interface AgenticReviewResult {
  reviewResult: ReviewResult | null;
  sessionId: string;
  fallback: boolean;
  fallbackReason?:
    "session_creation_failed" | "timeout" | "verification_mismatch";
}

export interface ChangedFilesCheck {
  reported: string[];
  actual: string[];
}

function verifyChangedFiles(
  check: ChangedFilesCheck
): { ok: true } | { ok: false; reason: "empty" | "partial" } {
  const { reported, actual } = check;

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

export async function runAgenticReview(
  apiKey: string,
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source: any,
  timeoutMinutes: number,
  changedFilesCheck?: ChangedFilesCheck
): Promise<AgenticReviewResult> {
  const customJules = jules.with({ apiKey });

  let session: SessionClient;

  try {
    core.info("Creating agentic Jules session…");
    session = await customJules.session({
      prompt,
      source,
      requireApproval: false,
      title: "Code Review (Agentic)",
      autoPr: false,
    });
    core.info(`Jules session: ${session.id}`);
  } catch (err) {
    const msg = getErrorMessage(err);
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

  try {
    await waitUntilSessionReady(session);

    const reviewMessage = await pollForReview(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session as any,
      timeoutMinutes * 60 * 1000
    );

    if (!reviewMessage) {
      core.info(`Agentic session ${session.id} timed out.`);
      logStructured("agentic_fallback", { reason: "timeout" });
      await archiveSession(session);
      return {
        reviewResult: null,
        sessionId: session.id,
        fallback: true,
        fallbackReason: "timeout",
      };
    }

    let reviewResult: ReviewResult;
    try {
      reviewResult = parseJulesResponse(reviewMessage);
    } catch (err) {
      core.error(`Failed to parse agentic Jules response: ${err}`);
      await archiveSession(session);
      return {
        reviewResult: {
          summary:
            "Jules returned an invalid response that could not be parsed. No valid code review comments are present.",
          verdict: "block",
          resolvedCommentIds: [],
          newComments: [],
        },
        sessionId: session.id,
        fallback: false,
      };
    }

    // changedFiles verification
    if (changedFilesCheck) {
      const reported = reviewResult.changedFiles ?? [];
      const result = verifyChangedFiles({
        reported,
        actual: changedFilesCheck.actual,
      });

      if (!result.ok) {
        core.info(
          `changedFiles verification failed: ${result.reason} (reported: ${reported.length}, actual: ${changedFilesCheck.actual.length})`
        );
        logStructured("agentic_fallback", {
          reason: "verification_mismatch",
          tier: result.reason,
          reportedCount: reported.length,
          actualCount: changedFilesCheck.actual.length,
        });
        await archiveSession(session);
        return {
          reviewResult: null,
          sessionId: session.id,
          fallback: true,
          fallbackReason: "verification_mismatch",
        };
      }

      if (reported.length > changedFilesCheck.actual.length) {
        logStructured("verification_mismatch", {
          tier: "extra_only",
          reportedCount: reported.length,
          actualCount: changedFilesCheck.actual.length,
        });
      }
    }

    await archiveSession(session);
    return { reviewResult, sessionId: session.id, fallback: false };
  } catch (err) {
    const msg = getErrorMessage(err);
    core.error(`Agentic review failed: ${msg}`);
    try {
      await archiveSession(session);
    } catch {
      // archive already handled inside archiveSession
    }
    throw err;
  }
}
