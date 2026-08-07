import * as core from "@actions/core";
import { jules, type SessionClient, type SourceInput } from "@google/jules-sdk";
import { ReviewResult } from "./types.js";
import { parseReviewResponse } from "./validation.js";
import { getErrorMessage } from "./errors.js";

type PollableSession = SessionClient & { hydrate: () => Promise<number> };

const PARSE_FAILURE_REVIEW: ReviewResult = {
  summary:
    "Jules returned an invalid response that could not be parsed. No valid code review comments are present.",
  verdict: "block",
  resolvedCommentIds: [],
  newComments: [],
};

export type SessionOutcome =
  | { kind: "review"; reviewResult: ReviewResult; sessionId: string }
  | { kind: "timeout"; sessionId: string }
  | { kind: "creation_failed"; sessionId: ""; error: unknown };

export interface RunSessionOptions {
  apiKey: string;
  prompt: string;
  source: SourceInput;
  title: string;
  timeoutMinutes: number;
}

export async function runSession(
  options: RunSessionOptions
): Promise<SessionOutcome> {
  const customJules = jules.with({ apiKey: options.apiKey });
  core.info("Creating Jules session…");

  let session: SessionClient;
  try {
    session = await customJules.session({
      prompt: options.prompt,
      source: options.source,
      requireApproval: false,
      title: options.title,
      autoPr: false,
    });
  } catch (err) {
    return { kind: "creation_failed", sessionId: "", error: err };
  }
  core.info(`Jules session: ${session.id}`);

  try {
    await waitUntilSessionReady(session);

    const reviewMessage = await pollForReview(
      session as PollableSession,
      options.timeoutMinutes * 60 * 1000
    );
    core.info(`Collected review (${reviewMessage.length} chars)`);

    if (!reviewMessage) {
      await archiveSession(session);
      return { kind: "timeout", sessionId: session.id };
    }

    let reviewResult: ReviewResult;
    try {
      reviewResult = parseReviewResponse(reviewMessage);
    } catch (err) {
      core.error(`Failed to parse Jules response: ${err}`);
      await archiveSession(session);
      return {
        kind: "review",
        reviewResult: PARSE_FAILURE_REVIEW,
        sessionId: session.id,
      };
    }

    await archiveSession(session);
    return { kind: "review", reviewResult, sessionId: session.id };
  } catch (err) {
    await archiveSession(session);
    throw err;
  }
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
  session: PollableSession,
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

async function archiveSession(session: {
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
