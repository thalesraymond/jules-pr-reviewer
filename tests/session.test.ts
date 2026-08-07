/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runSession, isAuthError } from "../src/session.js";
import { jules } from "@google/jules-sdk";
import * as core from "@actions/core";

vi.mock("@actions/core");

const mockSession = (historyEvents: any[]) => {
  return {
    id: "test-session-id",
    info: vi.fn().mockResolvedValue({}),
    hydrate: vi.fn().mockResolvedValue(1),
    archive: vi.fn().mockResolvedValue(undefined),
    history: async function* () {
      for (const event of historyEvents) {
        yield event;
      }
    },
  };
};

const runOptions = {
  apiKey: "api-key",
  prompt: "prompt",
  source: { github: "owner/repo", baseBranch: "main" },
  title: "Code Review",
  timeoutMinutes: 1,
};

describe("session.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("runSession", () => {
    it("returns a review outcome when the session produces a parseable message", async () => {
      const session = mockSession([
        {
          type: "agentMessaged",
          message: '{"summary":"ok","verdict":"approve"}',
        },
      ]);
      (jules as any).with = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(session),
      });

      const result = await runSession(runOptions);

      expect(result.kind).toBe("review");
      if (result.kind === "review") {
        expect(result.sessionId).toBe("test-session-id");
        expect(result.reviewResult.verdict).toBe("approve");
      }
      expect(session.archive).toHaveBeenCalled();
    });

    it("returns a block-verdict fallback review when the message cannot be parsed", async () => {
      const session = mockSession([
        { type: "agentMessaged", message: "this is not json" },
      ]);
      (jules as any).with = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(session),
      });

      const result = await runSession(runOptions);

      expect(result).toEqual({
        kind: "review",
        reviewResult: {
          summary: expect.stringContaining("could not be parsed"),
          verdict: "block",
          resolvedCommentIds: [],
          newComments: [],
        },
        sessionId: "test-session-id",
      });
      expect(core.error).toHaveBeenCalled();
      expect(session.archive).toHaveBeenCalled();
    });

    it("returns a timeout outcome when no message arrives before the deadline", async () => {
      const session = mockSession([]);
      (jules as any).with = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(session),
      });

      const promise = runSession(runOptions);
      await vi.advanceTimersByTimeAsync(61 * 1000);

      const result = await promise;
      expect(result).toEqual({ kind: "timeout", sessionId: "test-session-id" });
      expect(session.archive).toHaveBeenCalled();
    });

    it("returns a creation_failed outcome when session creation throws", async () => {
      const boom = new Error("session create exploded");
      (jules as any).with = vi.fn().mockReturnValue({
        session: vi.fn().mockRejectedValue(boom),
      });

      const result = await runSession(runOptions);

      expect(result).toEqual({
        kind: "creation_failed",
        sessionId: "",
        error: boom,
      });
    });

    it("throws an auth error and archives when readiness returns 401", async () => {
      const session = mockSession([]);
      session.info.mockRejectedValue(new Error("status code 401"));
      (jules as any).with = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(session),
      });

      await expect(runSession(runOptions)).rejects.toThrow(
        "Jules API rejected request"
      );
      expect(session.archive).toHaveBeenCalled();
    });

    it("throws and archives when readiness fails with a non-404 error", async () => {
      const session = mockSession([]);
      session.info.mockRejectedValue(new Error("boom"));
      (jules as any).with = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(session),
      });

      await expect(runSession(runOptions)).rejects.toThrow(
        "Jules session.info() failed"
      );
      expect(session.archive).toHaveBeenCalled();
    });

    it("waits through 404 responses until the session is ready", async () => {
      const session = mockSession([
        {
          type: "agentMessaged",
          message: '{"summary":"ok","verdict":"comment"}',
        },
      ]);
      session.info
        .mockRejectedValueOnce(new Error("status code 404"))
        .mockResolvedValueOnce({});
      (jules as any).with = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(session),
      });

      const promise = runSession(runOptions);
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;
      expect(result.kind).toBe("review");
      expect(session.info).toHaveBeenCalledTimes(2);
    });

    it("throws when the session never becomes ready", async () => {
      const session = mockSession([]);
      session.info.mockRejectedValue(new Error("status code 404"));
      (jules as any).with = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(session),
      });

      const promise = runSession(runOptions);
      const rejection = expect(promise).rejects.toThrow(
        "Session did not become ready within timeout."
      );
      await vi.advanceTimersByTimeAsync(260 * 1000);
      await rejection;
      expect(session.archive).toHaveBeenCalled();
    });

    it("throws an auth error and archives when polling fails with 401", async () => {
      const session = mockSession([]);
      session.hydrate.mockRejectedValue(new Error("status code 401"));
      (jules as any).with = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(session),
      });

      await expect(runSession(runOptions)).rejects.toThrow(
        "Jules API rejected request"
      );
      expect(session.archive).toHaveBeenCalled();
    });

    it("keeps polling past non-auth errors until the deadline", async () => {
      const session = mockSession([]);
      session.hydrate.mockRejectedValue(new Error("boom"));
      (jules as any).with = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(session),
      });

      const promise = runSession(runOptions);
      await vi.advanceTimersByTimeAsync(61 * 1000);

      const result = await promise;
      expect(result.kind).toBe("timeout");
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("hydrate/history error")
      );
    });

    it("still returns the outcome when archiving fails", async () => {
      const session = mockSession([
        {
          type: "agentMessaged",
          message: '{"summary":"ok","verdict":"approve"}',
        },
      ]);
      session.archive.mockRejectedValue(new Error("archive exploded"));
      (jules as any).with = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(session),
      });

      const result = await runSession(runOptions);

      expect(result.kind).toBe("review");
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("Failed to archive session")
      );
    });
  });

  describe("isAuthError", () => {
    it("returns true for 401", () => {
      expect(isAuthError("status code 401")).toBe(true);
    });

    it("returns true for 403", () => {
      expect(isAuthError("status 403 forbidden")).toBe(true);
    });

    it("returns false for other status codes", () => {
      expect(isAuthError("status 404 not found")).toBe(false);
      expect(isAuthError("status 500 server error")).toBe(false);
    });
  });
});
