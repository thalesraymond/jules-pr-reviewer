import * as core from "@actions/core";
import { jules } from "@google/jules-sdk";
import { ReviewResult } from "./types.js";

export async function runJulesReview(
  apiKey: string,
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source: any,
  timeoutMinutes: number
): Promise<{ reviewResult: ReviewResult | null; sessionId: string }> {
  const customJules = jules.with({ apiKey });

  core.info("Creating Jules review session…");

  const session = await customJules.session({
    prompt,
    source,
    requireApproval: false,
    autoPr: false,
  });
  core.info(`Jules session: ${session.id}`);

  await waitUntilSessionReady(session);

  const reviewMessage = await pollForReview(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session as any,
    timeoutMinutes * 60 * 1000
  );
  core.info(`Collected review (${reviewMessage.length} chars)`);

  if (!reviewMessage) {
    return { reviewResult: null, sessionId: session.id };
  }

  let reviewResult: ReviewResult;
  try {
    reviewResult = parseJulesResponse(reviewMessage);
  } catch (err) {
    core.error(`Failed to parse Jules response: ${err}`);
    return {
      reviewResult: {
        summary:
          "Jules returned an invalid response that could not be parsed. No valid code review comments are present.",
        verdict: "comment",
        resolvedCommentIds: [],
        newComments: [],
      },
      sessionId: session.id,
    };
  }

  return { reviewResult, sessionId: session.id };
}

function parseJulesResponse(message: string): ReviewResult {
  const jsonMatch = message.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]) as ReviewResult;
    } catch {
      // fallback
    }
  }
  // Try parsing the whole message if no codeblocks
  try {
    return JSON.parse(message) as ReviewResult;
  } catch (e) {
    throw new Error("Failed to parse Jules response as JSON", { cause: e });
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
      const msg = err instanceof Error ? err.message : String(err);
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
      const msg = err instanceof Error ? err.message : String(err);
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
  return /(?:\bstatus(?: code)?\s*(?:401|403)\b|\[(?:401|403)\b|\b(?:401|403)\s+(?:unauthorized|forbidden|unauthenticated)\b)/i.test(
    msg
  );
}

export function wrapPermissionError(
  err: unknown,
  needed: string,
  op: string
): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (isAuthError(msg) || msg.includes("Resource not accessible")) {
    return new Error(
      `${op} failed with 403. The github_token likely lacks ${needed}. Add to your workflow:\n` +
        "    permissions:\n      pull-requests: write\n      contents: read\n      statuses: write\n" +
        `(original: ${msg})`
    );
  }
  return err instanceof Error ? err : new Error(msg);
}
