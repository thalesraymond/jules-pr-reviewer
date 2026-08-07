/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runJulesReview,
  runAgenticReview,
  archiveSession,
  isAuthError,
  wrapPermissionError,
} from "../src/jules.js";
import { jules } from "@google/jules-sdk";
import * as core from "@actions/core";

vi.mock("@actions/core");

const mockSessionWithHistory = (historyEvents: any[]) => {
  return {
    id: "test-session-id",
    info: vi.fn().mockResolvedValue({}),
    hydrate: vi.fn().mockResolvedValue(1),
    history: async function* () {
      for (const event of historyEvents) {
        yield event;
      }
    },
  };
};

describe("jules.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("runJulesReview", () => {
    it("returns null if no reviewMessage is collected (both attempts timeout)", async () => {
      const sessionMock = vi.fn().mockResolvedValue(mockSessionWithHistory([]));
      const mockJulesWith = vi.fn().mockReturnValue({
        session: sessionMock,
      });
      (jules as any).with = mockJulesWith;

      const promise = runJulesReview("api-key", "prompt", {}, 1);

      // Fast-forward past both retry attempts (1 min each = 120s total)
      await vi.advanceTimersByTimeAsync(125 * 1000);

      const result = await promise;
      expect(result.reviewResult).toBeNull();
      expect(result.sessionId).toBe("test-session-id");
      // Both attempts should have created sessions
      expect(sessionMock).toHaveBeenCalledTimes(2);
    });

    it("returns parsed review result", async () => {
      const reviewText =
        '```json\n{"summary": "test", "verdict": "approve"}\n```';
      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi
          .fn()
          .mockResolvedValue(
            mockSessionWithHistory([
              { type: "agentMessaged", message: reviewText },
            ])
          ),
      });
      (jules as any).with = mockJulesWith;

      const result = await runJulesReview("api-key", "prompt", {}, 1);
      expect(result).toEqual({
        reviewResult: {
          summary: "test",
          verdict: "approve",
          resolvedCommentIds: [],
          newComments: [],
        },
        sessionId: "test-session-id",
      });
    });

    it("returns parsed review from fenced JSON with surrounding prose", async () => {
      const reviewText =
        'Here is the result:\n```JSON\n{"summary":"from prose","verdict":"comment"}\n```\nDone.';
      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi
          .fn()
          .mockResolvedValue(
            mockSessionWithHistory([
              { type: "agentMessaged", message: reviewText },
            ])
          ),
      });
      (jules as any).with = mockJulesWith;

      const result = await runJulesReview("api-key", "prompt", {}, 1);
      expect(result).toEqual({
        reviewResult: {
          summary: "from prose",
          verdict: "comment",
          resolvedCommentIds: [],
          newComments: [],
        },
        sessionId: "test-session-id",
      });
    });

    it("returns parsed review result without markdown blocks", async () => {
      const reviewText = '{"summary": "test2", "verdict": "approve"}';
      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi
          .fn()
          .mockResolvedValue(
            mockSessionWithHistory([
              { type: "agentMessaged", message: reviewText },
            ])
          ),
      });
      (jules as any).with = mockJulesWith;

      const result = await runJulesReview("api-key", "prompt", {}, 1);
      expect(result).toEqual({
        reviewResult: {
          summary: "test2",
          verdict: "approve",
          resolvedCommentIds: [],
          newComments: [],
        },
        sessionId: "test-session-id",
      });
    });

    it("handles parsing failure", async () => {
      const reviewText = "invalid json";
      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi
          .fn()
          .mockResolvedValue(
            mockSessionWithHistory([
              { type: "agentMessaged", message: reviewText },
            ])
          ),
      });
      (jules as any).with = mockJulesWith;

      const result = await runJulesReview("api-key", "prompt", {}, 1);
      expect(result).toEqual({
        reviewResult: {
          summary:
            "Jules returned an invalid response that could not be parsed. No valid code review comments are present.",
          verdict: "block",
          resolvedCommentIds: [],
          newComments: [],
        },
        sessionId: "test-session-id",
      });
      expect(core.error).toHaveBeenCalled();
    });

    it("handles JSON parse error when block format is invalid fallback", async () => {
      const reviewText = "```json\ninvalid\n```";
      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi
          .fn()
          .mockResolvedValue(
            mockSessionWithHistory([
              { type: "agentMessaged", message: reviewText },
            ])
          ),
      });
      (jules as any).with = mockJulesWith;

      const result = await runJulesReview("api-key", "prompt", {}, 1);
      expect(result).toEqual({
        reviewResult: {
          summary:
            "Jules returned an invalid response that could not be parsed. No valid code review comments are present.",
          verdict: "block",
          resolvedCommentIds: [],
          newComments: [],
        },
        sessionId: "test-session-id",
      });
      expect(core.error).toHaveBeenCalled();
    });

    it("handles parsing failure when JSON is valid but missing or invalid verdict", async () => {
      const reviewText = '{"summary": "missing verdict test"}';
      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi
          .fn()
          .mockResolvedValue(
            mockSessionWithHistory([
              { type: "agentMessaged", message: reviewText },
            ])
          ),
      });
      (jules as any).with = mockJulesWith;

      const result = await runJulesReview("api-key", "prompt", {}, 1);
      expect(result).toEqual({
        reviewResult: {
          summary:
            "Jules returned an invalid response that could not be parsed. No valid code review comments are present.",
          verdict: "block",
          resolvedCommentIds: [],
          newComments: [],
        },
        sessionId: "test-session-id",
      });
      expect(core.error).toHaveBeenCalled();
    });

    it("fails immediately when session.info() fails with non-auth, non-404 error", async () => {
      const sessionInfoMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("500 server error"));

      const mockSession = mockSessionWithHistory([
        {
          type: "agentMessaged",
          message: '{"summary":"test","verdict":"approve"}',
        },
      ]);
      mockSession.info = sessionInfoMock;

      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(mockSession),
      });
      (jules as any).with = mockJulesWith;

      await expect(runJulesReview("api-key", "prompt", {}, 1)).rejects.toThrow(
        "Jules session.info() failed: 500 server error"
      );
    });

    it("retries when session.info() fails with 404 string error", async () => {
      const sessionInfoMock = vi
        .fn()
        .mockRejectedValueOnce("404 Not found")
        .mockResolvedValueOnce({});

      const mockSession = mockSessionWithHistory([
        {
          type: "agentMessaged",
          message: '{"summary":"test","verdict":"approve"}',
        },
      ]);
      mockSession.info = sessionInfoMock;

      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(mockSession),
      });
      (jules as any).with = mockJulesWith;

      const promise = runJulesReview("api-key", "prompt", {}, 1);
      await vi.advanceTimersByTimeAsync(2000);

      await promise;
      expect(sessionInfoMock).toHaveBeenCalledTimes(2);
    });

    it("fails when session.info() throws auth error", async () => {
      const mockSession = mockSessionWithHistory([]);
      mockSession.info = vi
        .fn()
        .mockRejectedValue(new Error("401 Unauthorized"));

      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(mockSession),
      });
      (jules as any).with = mockJulesWith;

      await expect(runJulesReview("api-key", "prompt", {}, 1)).rejects.toThrow(
        "Jules API rejected request (401 Unauthorized). Check JULES_API_KEY is valid."
      );
    });

    it("fails when session.info() fails max attempts", async () => {
      const mockSession = mockSessionWithHistory([]);
      mockSession.info = vi.fn().mockRejectedValue(new Error("404 not found"));

      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(mockSession),
      });
      (jules as any).with = mockJulesWith;

      const promise = expect(
        runJulesReview("api-key", "prompt", {}, 1)
      ).rejects.toThrow("Session did not become ready within timeout.");

      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersToNextTimerAsync();
      }

      await promise;
    });

    it("handles hydrate failure with string error and non-agentMessaged event", async () => {
      const hydrateMock = vi
        .fn()
        .mockRejectedValueOnce("Timeout")
        .mockResolvedValueOnce(1);

      const mockSession = mockSessionWithHistory([
        { type: "thought", message: "thinking" },
        {
          type: "agentMessaged",
          message: '{"summary":"test","verdict":"approve"}',
        },
      ]);
      mockSession.hydrate = hydrateMock;

      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(mockSession),
      });
      (jules as any).with = mockJulesWith;

      const promise = runJulesReview("api-key", "prompt", {}, 1);
      await vi.advanceTimersByTimeAsync(20000); // Poll delay

      const result = await promise;
      expect(result.reviewResult?.verdict).toBe("approve");
      expect(hydrateMock).toHaveBeenCalledTimes(2);
    });

    it("fails when hydrate throws auth error", async () => {
      const mockSession = mockSessionWithHistory([]);
      mockSession.hydrate = vi
        .fn()
        .mockRejectedValue(new Error("403 Forbidden"));

      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(mockSession),
      });
      (jules as any).with = mockJulesWith;

      const promise = runJulesReview("api-key", "prompt", {}, 1);
      await expect(promise).rejects.toThrow(
        "Jules API rejected request (403 Forbidden). Check JULES_API_KEY is valid."
      );
    });

    // ── Retry behavior tests ──────────────────────────────────────────

    it("retries on timeout: first attempt times out, second succeeds", async () => {
      const reviewText = '{"summary": "retry success", "verdict": "approve"}';
      const timeoutSession = {
        id: "timeout-session-1",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        history: async function* () {
          /* no agentMessaged */
        },
      };
      const successSession = {
        id: "success-session-2",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        history: async function* () {
          yield { type: "agentMessaged", message: reviewText };
        },
      };

      const sessionMock = vi
        .fn()
        .mockResolvedValueOnce(timeoutSession)
        .mockResolvedValueOnce(successSession);
      const mockJulesWith = vi.fn().mockReturnValue({
        session: sessionMock,
      });
      (jules as any).with = mockJulesWith;

      const promise = runJulesReview("api-key", "prompt", {}, 1);
      // First attempt times out after ~60s
      await vi.advanceTimersByTimeAsync(61 * 1000);

      const result = await promise;
      expect(result.reviewResult).toEqual({
        summary: "retry success",
        verdict: "approve",
        resolvedCommentIds: [],
        newComments: [],
      });
      expect(result.sessionId).toBe("success-session-2");
      // Only two sessions created
      expect(sessionMock).toHaveBeenCalledTimes(2);
    });

    it("retries on timeout: both attempts timeout returns null with error log", async () => {
      const session1 = {
        id: "fail-session-1",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        history: async function* () {
          /* no agentMessaged */
        },
      };
      const session2 = {
        id: "fail-session-2",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        history: async function* () {
          /* no agentMessaged */
        },
      };

      const sessionMock = vi
        .fn()
        .mockResolvedValueOnce(session1)
        .mockResolvedValueOnce(session2);
      const mockJulesWith = vi.fn().mockReturnValue({
        session: sessionMock,
      });
      (jules as any).with = mockJulesWith;

      const promise = runJulesReview("api-key", "prompt", {}, 1);
      // Both attempts: 1 min each = 120s total
      await vi.advanceTimersByTimeAsync(125 * 1000);

      const result = await promise;
      expect(result.reviewResult).toBeNull();
      expect(result.sessionId).toBe("fail-session-2");
      // core.error should be called with both session IDs
      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining("fail-session-1")
      );
      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining("fail-session-2")
      );
    });

    it("does not retry on auth error (401)", async () => {
      const mockSession = {
        id: "auth-fail-session",
        info: vi.fn().mockRejectedValue(new Error("401 Unauthorized")),
        hydrate: vi.fn().mockResolvedValue(1),
        history: async function* () {
          yield {
            type: "agentMessaged",
            message: '{"summary":"s","verdict":"approve"}',
          };
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(mockSession);
      const mockJulesWith = vi.fn().mockReturnValue({
        session: sessionMock,
      });
      (jules as any).with = mockJulesWith;

      await expect(runJulesReview("api-key", "prompt", {}, 1)).rejects.toThrow(
        "Jules API rejected request"
      );
      // Only one session created — no retry
      expect(sessionMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry on auth error (403)", async () => {
      const mockSession = {
        id: "forbidden-session",
        info: vi.fn().mockRejectedValue(new Error("403 Forbidden")),
        hydrate: vi.fn().mockResolvedValue(1),
        history: async function* () {
          yield {
            type: "agentMessaged",
            message: '{"summary":"s","verdict":"approve"}',
          };
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(mockSession);
      const mockJulesWith = vi.fn().mockReturnValue({
        session: sessionMock,
      });
      (jules as any).with = mockJulesWith;

      await expect(runJulesReview("api-key", "prompt", {}, 1)).rejects.toThrow(
        "Jules API rejected request"
      );
      expect(sessionMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry on parse error — returns fallback", async () => {
      const mockSession = {
        id: "parse-fail-session",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        history: async function* () {
          yield { type: "agentMessaged", message: "not valid json at all" };
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(mockSession);
      const mockJulesWith = vi.fn().mockReturnValue({
        session: sessionMock,
      });
      (jules as any).with = mockJulesWith;

      const result = await runJulesReview("api-key", "prompt", {}, 1);
      expect(result.reviewResult).toEqual({
        summary:
          "Jules returned an invalid response that could not be parsed. No valid code review comments are present.",
        verdict: "block",
        resolvedCommentIds: [],
        newComments: [],
      });
      expect(result.sessionId).toBe("parse-fail-session");
      // Only one session — no retry on parse error
      expect(sessionMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry on readiness failure (404 loop)", async () => {
      const mockSession = {
        id: "ready-fail-session",
        info: vi.fn().mockRejectedValue(new Error("404 not found")),
        hydrate: vi.fn().mockResolvedValue(1),
        history: async function* () {
          yield {
            type: "agentMessaged",
            message: '{"summary":"s","verdict":"approve"}',
          };
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(mockSession);
      const mockJulesWith = vi.fn().mockReturnValue({
        session: sessionMock,
      });
      (jules as any).with = mockJulesWith;

      const promise = expect(
        runJulesReview("api-key", "prompt", {}, 1)
      ).rejects.toThrow("Session did not become ready within timeout.");

      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersToNextTimerAsync();
      }

      await promise;
      // Only one session — no retry
      expect(sessionMock).toHaveBeenCalledTimes(1);
    });

    it("logs retry event with structured data", async () => {
      const timeoutSession = {
        id: "timeout-logs-session",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        history: async function* () {
          /* no agentMessaged */
        },
      };
      const successSession = {
        id: "success-logs-session",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        history: async function* () {
          yield {
            type: "agentMessaged",
            message: '{"summary":"ok","verdict":"approve"}',
          };
        },
      };

      const sessionMock = vi
        .fn()
        .mockResolvedValueOnce(timeoutSession)
        .mockResolvedValueOnce(successSession);
      const mockJulesWith = vi.fn().mockReturnValue({
        session: sessionMock,
      });
      (jules as any).with = mockJulesWith;

      const promise = runJulesReview("api-key", "prompt", {}, 1);
      await vi.advanceTimersByTimeAsync(61 * 1000);

      const result = await promise;
      expect(result.sessionId).toBe("success-logs-session");

      // Should have logged retry info with structured data
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("timeout-logs-session")
      );
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("Retrying with a fresh session")
      );
      // Structured log event
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('"event":"jules_retry"')
      );
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('"failedSessionId":"timeout-logs-session"')
      );
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('"attempt":1')
      );
    });

    it("first attempt succeeds — no second session created", async () => {
      const reviewText = '{"summary": "first try works", "verdict": "comment"}';
      const sessionMock = vi
        .fn()
        .mockResolvedValue(
          mockSessionWithHistory([
            { type: "agentMessaged", message: reviewText },
          ])
        );
      const mockJulesWith = vi.fn().mockReturnValue({
        session: sessionMock,
      });
      (jules as any).with = mockJulesWith;

      const result = await runJulesReview("api-key", "prompt", {}, 1);
      expect(result.reviewResult).toEqual({
        summary: "first try works",
        verdict: "comment",
        resolvedCommentIds: [],
        newComments: [],
      });
      // Only one session created
      expect(sessionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("isAuthError & wrapPermissionError", () => {
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

    it("wraps 403 error with helpful instructions", () => {
      const err = new Error("Request failed with status 403");
      const result = wrapPermissionError(
        err,
        "statuses:write",
        "createCommitStatus"
      );
      expect(result.message).toContain("createCommitStatus failed with 403");
      expect(result.message).toContain("permissions:");
    });

    it("wraps Resource not accessible error with helpful instructions", () => {
      const err = new Error("Resource not accessible by integration");
      const result = wrapPermissionError(
        err,
        "statuses:write",
        "createCommitStatus"
      );
      expect(result.message).toContain("createCommitStatus failed with 403");
      expect(result.message).toContain("permissions:");
    });

    it("passes through other Error instances unchanged", () => {
      const err = new Error("Some other error");
      const result = wrapPermissionError(
        err,
        "statuses:write",
        "createCommitStatus"
      );
      expect(result).toBe(err);
    });

    it("wraps non-Error objects into an Error", () => {
      const err = "Just a string error";
      const result = wrapPermissionError(
        err,
        "statuses:write",
        "createCommitStatus"
      );
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("Just a string error");
    });
  });

  describe("archiveSession", () => {
    it("calls session.archive() on success", async () => {
      const archiveMock = vi.fn().mockResolvedValue(undefined);
      await archiveSession({ id: "s1", archive: archiveMock } as any);
      expect(archiveMock).toHaveBeenCalledTimes(1);
    });

    it("does not throw when archive fails", async () => {
      const archiveMock = vi.fn().mockRejectedValue(new Error("archive fail"));
      await archiveSession({ id: "s1", archive: archiveMock } as any);
      expect(archiveMock).toHaveBeenCalledTimes(1);
      expect(core.warning).toHaveBeenCalled();
    });
  });

  describe("runAgenticReview", () => {
    it("returns parsed review result on success", async () => {
      const reviewText =
        '{"summary":"agentic ok","verdict":"approve","changedFiles":["src/a.ts"]}';
      const mockSession = {
        id: "agentic-session-1",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        archive: vi.fn().mockResolvedValue(undefined),
        history: async function* () {
          yield { type: "agentMessaged", message: reviewText };
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(mockSession);
      (jules as any).with = vi.fn().mockReturnValue({ session: sessionMock });

      const result = await runAgenticReview(
        "api-key",
        "prompt",
        { github: "owner/repo", baseBranch: "main" },
        30,
        { reported: ["src/a.ts"], actual: ["src/a.ts"] }
      );

      expect(result.reviewResult?.verdict).toBe("approve");
      expect(result.reviewResult?.changedFiles).toEqual(["src/a.ts"]);
      expect(mockSession.archive).toHaveBeenCalled();
    });

    it("falls back when session creation fails", async () => {
      const sessionMock = vi
        .fn()
        .mockRejectedValue(new Error("branch not found"));
      (jules as any).with = vi.fn().mockReturnValue({ session: sessionMock });

      const result = await runAgenticReview(
        "api-key",
        "prompt",
        { github: "owner/repo", baseBranch: "deleted-branch" },
        30,
        { reported: ["src/a.ts"], actual: ["src/a.ts"] }
      );

      expect(result.fallback).toBe(true);
      expect(result.fallbackReason).toBe("session_creation_failed");
    });

    it("falls back on timeout", async () => {
      const timeoutSession = {
        id: "timeout-agentic",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        archive: vi.fn().mockResolvedValue(undefined),
        history: async function* () {
          /* no agentMessaged */
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(timeoutSession);
      (jules as any).with = vi.fn().mockReturnValue({ session: sessionMock });

      const promise = runAgenticReview(
        "api-key",
        "prompt",
        { github: "owner/repo", baseBranch: "main" },
        1,
        { reported: ["src/a.ts"], actual: ["src/a.ts"] }
      );

      await vi.advanceTimersByTimeAsync(65 * 1000);

      const result = await promise;
      expect(result.fallback).toBe(true);
      expect(result.fallbackReason).toBe("timeout");
    });

    it("proceeds when changedFiles is empty — mismatch is logged only", async () => {
      const reviewText =
        '{"summary":"empty files","verdict":"approve","changedFiles":[]}';
      const mockSession = {
        id: "empty-files-session",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        archive: vi.fn().mockResolvedValue(undefined),
        history: async function* () {
          yield { type: "agentMessaged", message: reviewText };
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(mockSession);
      (jules as any).with = vi.fn().mockReturnValue({ session: sessionMock });

      const result = await runAgenticReview(
        "api-key",
        "prompt",
        { github: "owner/repo", baseBranch: "main" },
        30,
        { reported: [], actual: ["src/a.ts"] }
      );

      expect(result.fallback).toBe(false);
      expect(result.reviewResult?.verdict).toBe("approve");
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('"event":"verification_mismatch"')
      );
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('"tier":"empty"')
      );
    });

    it("proceeds when changedFiles is partial — fewer files reported than actual", async () => {
      const reviewText =
        '{"summary":"partial","verdict":"approve","changedFiles":["src/a.ts"]}';
      const mockSession = {
        id: "partial-session",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        archive: vi.fn().mockResolvedValue(undefined),
        history: async function* () {
          yield { type: "agentMessaged", message: reviewText };
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(mockSession);
      (jules as any).with = vi.fn().mockReturnValue({ session: sessionMock });

      const result = await runAgenticReview(
        "api-key",
        "prompt",
        { github: "owner/repo", baseBranch: "main" },
        30,
        { reported: ["src/a.ts"], actual: ["src/a.ts", "src/b.ts"] }
      );

      expect(result.fallback).toBe(false);
      expect(result.reviewResult?.verdict).toBe("approve");
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('"event":"verification_mismatch"')
      );
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('"tier":"partial"')
      );
    });

    it("proceeds when changedFiles is omitted — no fallback", async () => {
      const reviewText = '{"summary":"no files field","verdict":"approve"}';
      const mockSession = {
        id: "omitted-files-session",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        archive: vi.fn().mockResolvedValue(undefined),
        history: async function* () {
          yield { type: "agentMessaged", message: reviewText };
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(mockSession);
      (jules as any).with = vi.fn().mockReturnValue({ session: sessionMock });

      const result = await runAgenticReview(
        "api-key",
        "prompt",
        { github: "owner/repo", baseBranch: "main" },
        30,
        { reported: [], actual: ["src/a.ts"] }
      );

      expect(result.fallback).toBe(false);
      expect(result.reviewResult?.verdict).toBe("approve");
    });

    it("proceeds when changedFiles is extra-only (superset)", async () => {
      const reviewText =
        '{"summary":"extra ok","verdict":"approve","changedFiles":["src/a.ts","src/b.ts","src/c.ts"]}';
      const mockSession = {
        id: "extra-session",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        archive: vi.fn().mockResolvedValue(undefined),
        history: async function* () {
          yield { type: "agentMessaged", message: reviewText };
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(mockSession);
      (jules as any).with = vi.fn().mockReturnValue({ session: sessionMock });

      const result = await runAgenticReview(
        "api-key",
        "prompt",
        { github: "owner/repo", baseBranch: "main" },
        30,
        {
          reported: ["src/a.ts", "src/b.ts", "src/c.ts"],
          actual: ["src/a.ts", "src/b.ts"],
        }
      );

      expect(result.fallback).toBe(false);
      expect(result.reviewResult?.verdict).toBe("approve");
    });

    it("archive is called on successful session", async () => {
      const reviewText = '{"summary":"ok","verdict":"approve"}';
      const archiveMock = vi.fn().mockResolvedValue(undefined);
      const mockSession = {
        id: "archive-test",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        archive: archiveMock,
        history: async function* () {
          yield { type: "agentMessaged", message: reviewText };
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(mockSession);
      (jules as any).with = vi.fn().mockReturnValue({ session: sessionMock });

      await runAgenticReview(
        "api-key",
        "prompt",
        { github: "owner/repo", baseBranch: "main" },
        30,
        { reported: ["src/a.ts"], actual: ["src/a.ts"] }
      );

      expect(archiveMock).toHaveBeenCalledTimes(1);
    });

    it("archive failure does not throw", async () => {
      const reviewText =
        '{"summary":"ok","verdict":"approve","changedFiles":["src/a.ts"]}';
      const archiveMock = vi
        .fn()
        .mockRejectedValue(new Error("archive broken"));
      const mockSession = {
        id: "archive-fail-test",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        archive: archiveMock,
        history: async function* () {
          yield { type: "agentMessaged", message: reviewText };
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(mockSession);
      (jules as any).with = vi.fn().mockReturnValue({ session: sessionMock });

      const result = await runAgenticReview(
        "api-key",
        "prompt",
        { github: "owner/repo", baseBranch: "main" },
        30,
        { reported: ["src/a.ts"], actual: ["src/a.ts"] }
      );

      expect(result.reviewResult?.verdict).toBe("approve");
      expect(core.warning).toHaveBeenCalled();
    });

    it("archive is called on fallback session", async () => {
      const archiveMock = vi.fn().mockResolvedValue(undefined);
      const timeoutSession = {
        id: "fallback-archive",
        info: vi.fn().mockResolvedValue({}),
        hydrate: vi.fn().mockResolvedValue(1),
        archive: archiveMock,
        history: async function* () {
          /* no agentMessaged */
        },
      };

      const sessionMock = vi.fn().mockResolvedValue(timeoutSession);
      (jules as any).with = vi.fn().mockReturnValue({ session: sessionMock });

      const promise = runAgenticReview(
        "api-key",
        "prompt",
        { github: "owner/repo", baseBranch: "main" },
        1,
        { reported: ["src/a.ts"], actual: ["src/a.ts"] }
      );

      await vi.advanceTimersByTimeAsync(65 * 1000);

      await promise;
      expect(archiveMock).toHaveBeenCalled();
    });
  });
});
