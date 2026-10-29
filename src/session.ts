import * as core from "@actions/core";
import { jules, type SessionClient, type SourceInput } from "@google/jules-sdk";
import { ReviewResult } from "./types.js";
import { parseReviewResponse } from "./validation.js";
import {
  getErrorMessage,
  isAuthError,
  isQuotaError,
  AuthError,
  QuotaExceededError,
  QUOTA_HINT,
} from "./errors.js";
import { logStructured } from "./logging.js";
import { sleep } from "./utils.js";
import type { ReusableSession } from "./sessionReuse.js";

type PollableSession = SessionClient & { hydrate: () => Promise<number> };

const PARSE_FAILURE_REVIEW: ReviewResult = {
  summary:
    "Jules returned an invalid response that could not be parsed. No valid code review comments are present.",
  verdict: "block",
  resolvedCommentIds: [],
  newComments: [],
  unparseable: true,
};

export type SessionOutcome =
  | {
      kind: "review";
      reviewResult: ReviewResult;
      sessionId: string;
      sessionFollowups?: number;
    }
  | { kind: "timeout"; sessionId: string }
  | { kind: "creation_failed"; sessionId: ""; error: unknown };

export interface RunSessionOptions {
  apiKey: string;
  prompt: string;
  source: SourceInput;
  title: string;
  timeoutMinutes: number;
  reusableSession?: ReusableSession;
}

export async function runSession(
  options: RunSessionOptions
): Promise<SessionOutcome> {
  const customJules = jules.with({ apiKey: options.apiKey });
  core.info(
    options.reusableSession
      ? "Reopening Jules session…"
      : "Creating Jules session…"
  );

  let session: SessionClient;
  try {
    session = options.reusableSession
      ? customJules.session(options.reusableSession.sessionId)
      : await customJules.session({
          prompt: options.prompt,
          source: options.source,
          requireApproval: false,
          title: options.title,
          autoPr: false,
        });
  } catch (err) {
    return {
      kind: "creation_failed",
      sessionId: "",
      error: wrapJulesError(err) ?? err,
    };
  }
  core.info(`Jules session: ${session.id}`);

  let ownsSession = !options.reusableSession;
  try {
    const previousActivityIds = new Set<string>();
    if (options.reusableSession) {
      const info = await session.info();
      if (info.state !== "completed" && info.state !== "awaitingUserFeedback") {
        throw new Error("Previous session is not ready for a follow-up.");
      }
      ownsSession = true;
      await session.unarchive();
      await (session as PollableSession).hydrate();
      for await (const activity of session.history())
        previousActivityIds.add(activity.id);
      await session.send(
        `Review the current PR from scratch. Do not rely on earlier reviews or conclusions. The following prompt replaces all earlier review requests.\n\n${options.prompt}`
      );
    } else {
      await waitUntilSessionReady(session);
    }

    const reviewMessage = await pollForReview(
      session as PollableSession,
      options.timeoutMinutes * 60 * 1000,
      previousActivityIds
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
      const msg = getErrorMessage(err);
      logStructured("review_failed", {
        reason: msg,
        stage: "parse",
        kind: "parse",
      });
      core.error(`Failed to parse Jules response: ${msg}`);
      await archiveSession(session);
      return {
        kind: "review",
        reviewResult: PARSE_FAILURE_REVIEW,
        sessionId: session.id,
      };
    }

    await archiveSession(session);
    return {
      kind: "review",
      reviewResult,
      sessionId: session.id,
      ...(options.reusableSession
        ? { sessionFollowups: options.reusableSession.followups + 1 }
        : {}),
    };
  } catch (err) {
    // A busy or inaccessible candidate may still belong to another run.
    if (ownsSession) await archiveSession(session);
    if (options.reusableSession) {
      return {
        kind: "creation_failed",
        sessionId: "",
        error: wrapJulesError(err) ?? err,
      };
    }
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
      const wrapped = wrapJulesError(err);
      if (wrapped) throw wrapped;
      const msg = getErrorMessage(err);
      if (!msg.includes("404")) {
        throw new Error(`Jules session.info() failed: ${msg}`, { cause: err });
      }
      core.info(`Session not yet ready (attempt ${i + 1}/${maxAttempts})…`);
      await sleep(delay);
      delay = Math.min(delay * 1.5, 15000);
    }
  }
  throw new Error("Session did not become ready within timeout.");
}

async function pollForReview(
  session: PollableSession,
  timeoutMs: number,
  previousActivityIds: ReadonlySet<string>
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      await session.hydrate();
      let last = "";
      for await (const a of session.history()) {
        if (a.type === "agentMessaged" && !previousActivityIds.has(a.id))
          last = a.message;
      }
      if (last) {
        core.info(`Got agentMessaged on attempt ${attempt}.`);
        return last;
      }
      core.info(`No agentMessaged yet (attempt ${attempt})…`);
    } catch (err) {
      const wrapped = wrapJulesError(err);
      if (wrapped) throw wrapped;
      core.info(
        `hydrate/history error (attempt ${attempt}): ${getErrorMessage(err)}`
      );
    }
    await sleep(20_000);
  }
  return "";
}

/** Wrap a Jules API error in an actionable typed error, or return null. */
function wrapJulesError(err: unknown): QuotaExceededError | AuthError | null {
  const msg = getErrorMessage(err);
  if (isQuotaError(msg)) {
    return new QuotaExceededError(quotaMessage(msg), { cause: err });
  }
  if (isAuthError(msg)) {
    return new AuthError(authMessage(msg), { cause: err });
  }
  return null;
}

function quotaMessage(msg: string): string {
  return `Jules API quota or rate limit exceeded (${msg}). ${QUOTA_HINT}`;
}

function authMessage(msg: string): string {
  return `Jules API rejected request (${msg}). Check JULES_API_KEY is valid.`;
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
