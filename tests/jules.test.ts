import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runJulesReview,
  runAgenticReview,
  wrapPermissionError,
} from "../src/jules.js";
import { QuotaExceededError } from "../src/errors.js";
import { runSession } from "../src/session.js";
import * as core from "@actions/core";

vi.mock("@actions/core");

vi.mock("../src/session.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/session.js")>();
  return {
    ...actual,
    runSession: vi.fn(),
  };
});

const mockedRunSession = vi.mocked(runSession);

const source = { github: "owner/repo", baseBranch: "main" };

const reviewResult = {
  summary: "Looks good",
  verdict: "approve" as const,
  resolvedCommentIds: [],
  newComments: [],
};

describe("runJulesReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the review when the session succeeds", async () => {
    mockedRunSession.mockResolvedValue({
      kind: "review",
      reviewResult,
      sessionId: "s1",
    });

    const result = await runJulesReview("api-key", "prompt", source, 30);

    expect(result).toEqual({ reviewResult, sessionId: "s1" });
    expect(mockedRunSession).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first session times out", async () => {
    mockedRunSession
      .mockResolvedValueOnce({ kind: "timeout", sessionId: "s-timeout" })
      .mockResolvedValueOnce({ kind: "review", reviewResult, sessionId: "s2" });

    const result = await runJulesReview("api-key", "prompt", source, 30);

    expect(result.sessionId).toBe("s2");
    expect(mockedRunSession).toHaveBeenCalledTimes(2);
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining("Retrying with a fresh session")
    );
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"jules_retry"')
    );
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('"failedSessionId":"s-timeout"')
    );
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('"attempt":1')
    );
  });

  it("returns null when both attempts time out", async () => {
    mockedRunSession
      .mockResolvedValueOnce({ kind: "timeout", sessionId: "s1" })
      .mockResolvedValueOnce({ kind: "timeout", sessionId: "s2" });

    const result = await runJulesReview("api-key", "prompt", source, 30);

    expect(result.reviewResult).toBeNull();
    expect(result.sessionId).toBe("s2");
    expect(mockedRunSession).toHaveBeenCalledTimes(2);
    expect(core.error).toHaveBeenCalledWith(
      expect.stringContaining("session s1 and retry session s2")
    );
  });

  it("rethrows when session creation fails", async () => {
    const boom = new Error("creation exploded");
    mockedRunSession.mockResolvedValue({
      kind: "creation_failed",
      sessionId: "",
      error: boom,
    });

    await expect(
      runJulesReview("api-key", "prompt", source, 30)
    ).rejects.toThrow("creation exploded");
  });
});

describe("runAgenticReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a session_creation_failed fallback when creation fails", async () => {
    mockedRunSession.mockResolvedValue({
      kind: "creation_failed",
      sessionId: "",
      error: new Error("boom"),
    });

    const result = await runAgenticReview("api-key", "prompt", source, 30);

    expect(result).toEqual({
      reviewResult: null,
      sessionId: "",
      fallback: true,
      fallbackReason: "session_creation_failed",
    });
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Agentic session creation failed")
    );
  });

  it("throws a quota error instead of falling back when creation hits the session cap", async () => {
    mockedRunSession.mockResolvedValue({
      kind: "creation_failed",
      sessionId: "",
      error: new QuotaExceededError(
        "Jules API quota or rate limit exceeded (status 429). The free tier allows 15 sessions per 24 hours."
      ),
    });

    await expect(
      runAgenticReview("api-key", "prompt", source, 30)
    ).rejects.toThrow("15 sessions per 24 hours");
    expect(core.warning).not.toHaveBeenCalled();
  });

  it("returns a timeout fallback when the session times out", async () => {
    mockedRunSession.mockResolvedValue({ kind: "timeout", sessionId: "s1" });

    const result = await runAgenticReview("api-key", "prompt", source, 30);

    expect(result).toEqual({
      reviewResult: null,
      sessionId: "s1",
      fallback: true,
      fallbackReason: "timeout",
    });
  });

  it("returns the review with fallback false when the session succeeds", async () => {
    mockedRunSession.mockResolvedValue({
      kind: "review",
      reviewResult,
      sessionId: "s1",
    });

    const result = await runAgenticReview("api-key", "prompt", source, 30);

    expect(result.fallback).toBe(false);
    expect(result.sessionId).toBe("s1");
    expect(result.reviewResult?.verdict).toBe("approve");
  });

  it("logs empty verification mismatch when no files are reported", async () => {
    mockedRunSession.mockResolvedValue({
      kind: "review",
      reviewResult: { ...reviewResult, changedFiles: [] },
      sessionId: "s1",
    });

    await runAgenticReview("api-key", "prompt", source, 30, ["src/a.ts"]);

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("changedFiles mismatch")
    );
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"verification_mismatch"')
    );
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('"tier":"empty"')
    );
  });

  it("logs partial verification mismatch when some files are missing", async () => {
    mockedRunSession.mockResolvedValue({
      kind: "review",
      reviewResult: { ...reviewResult, changedFiles: ["src/a.ts"] },
      sessionId: "s1",
    });

    await runAgenticReview("api-key", "prompt", source, 30, [
      "src/a.ts",
      "src/b.ts",
    ]);

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('"tier":"partial"')
    );
  });

  it("logs extra_only when reported files exceed actual", async () => {
    mockedRunSession.mockResolvedValue({
      kind: "review",
      reviewResult: {
        ...reviewResult,
        changedFiles: ["src/a.ts", "src/b.ts"],
      },
      sessionId: "s1",
    });

    await runAgenticReview("api-key", "prompt", source, 30, ["src/a.ts"]);

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('"tier":"extra_only"')
    );
  });

  it("does not verify changedFiles when none are expected", async () => {
    mockedRunSession.mockResolvedValue({
      kind: "review",
      reviewResult,
      sessionId: "s1",
    });

    await runAgenticReview("api-key", "prompt", source, 30);

    expect(core.warning).not.toHaveBeenCalled();
  });
});

describe("wrapPermissionError", () => {
  it("wraps 403 error with helpful instructions", () => {
    const err = new Error("Request failed with status 403");
    const result = wrapPermissionError(err, "checks:write", "createCheckRun");
    expect(result.message).toContain("createCheckRun failed with 403");
    expect(result.message).toContain("permissions:");
    expect(result.message).toContain("checks: write");
  });

  it("wraps Resource not accessible error with helpful instructions", () => {
    const err = new Error("Resource not accessible by integration");
    const result = wrapPermissionError(err, "checks:write", "createCheckRun");
    expect(result.message).toContain("createCheckRun failed with 403");
    expect(result.message).toContain("permissions:");
    expect(result.message).toContain("checks: write");
  });

  it("passes through other Error instances unchanged", () => {
    const err = new Error("Some other error");
    const result = wrapPermissionError(err, "checks:write", "createCheckRun");
    expect(result).toBe(err);
  });

  it("wraps non-Error objects into an Error", () => {
    const err = "Just a string error";
    const result = wrapPermissionError(err, "checks:write", "createCheckRun");
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("Just a string error");
  });
});
