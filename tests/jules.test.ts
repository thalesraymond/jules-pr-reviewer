/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runJulesReview,
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
    it("returns null if no reviewMessage is collected", async () => {
      const mockJulesWith = vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue(mockSessionWithHistory([])),
      });
      (jules as any).with = mockJulesWith;

      const promise = runJulesReview("api-key", "prompt", {}, 1);

      // Fast-forward to timeout
      await vi.advanceTimersByTimeAsync(60 * 1000 + 1000);

      const result = await promise;
      expect(result).toEqual({
        reviewResult: null,
        sessionId: "test-session-id",
      });
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
        reviewResult: { summary: "test", verdict: "approve" },
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
        reviewResult: { summary: "test2", verdict: "approve" },
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
        reviewResult: null,
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
        reviewResult: null,
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
});
