import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@actions/core";
import {
  executeReview,
  type ExecuteReviewConfig,
} from "../src/executeReview.js";
import { runSession } from "../src/session.js";
import { logStructured } from "../src/logging.js";
import { AuthError, QuotaExceededError } from "../src/errors.js";
import type { PreparedDiff } from "../src/reviewPreparation.js";

vi.mock("@actions/core");
vi.mock("../src/session.js", () => ({ runSession: vi.fn() }));
vi.mock("../src/logging.js", () => ({ logStructured: vi.fn() }));

const session = vi.mocked(runSession);
const reviewResult = {
  verdict: "comment" as const,
  summary: "Looks good",
  resolvedCommentIds: [],
  newComments: [],
};
const config: ExecuteReviewConfig = {
  diffMode: "prompt",
  dedupe: true,
  strictness: "chill",
  largePrThreshold: 80_000,
  largePrStrategy: "prioritize",
  timeoutMinutes: 30,
};
const prepared: PreparedDiff = {
  diff: "diff --git a/src/a.ts b/src/a.ts\n+change\n",
  changedFiles: ["src/a.ts"],
  perPathRules: [],
  openThreads: [],
};

function run(
  overrides: Partial<ExecuteReviewConfig> = {},
  diff: PreparedDiff = prepared,
  pr = {
    title: "PR Title",
    body: "PR Body",
    head: { ref: "feature" },
    base: { ref: "main" },
  }
) {
  return executeReview(
    "api-key",
    42,
    pr,
    diff,
    "owner/repo",
    "baseSHA",
    "headSHA",
    {
      ...config,
      ...overrides,
    }
  );
}

function expectCompletion(success: boolean, duration = 0) {
  const events = vi
    .mocked(logStructured)
    .mock.calls.filter(([event]) => event === "jules_api_called");
  expect(events).toEqual([["jules_api_called", { success, duration }]]);
}

describe("executeReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.mockReset();
    vi.useFakeTimers();
    session.mockResolvedValue({
      kind: "review",
      reviewResult,
      sessionId: "s1",
    });
  });

  afterEach(() => vi.useRealTimers());

  it("builds a prompt review and owns its completion telemetry", async () => {
    const result = await run();
    expect(result).toMatchObject({ reviewResult, sessionId: "s1" });
    expect(session).toHaveBeenCalledExactlyOnceWith({
      apiKey: "api-key",
      prompt: expect.stringContaining("src/a.ts"),
      source: { github: "owner/repo", baseBranch: "main" },
      title: "Code Review",
      timeoutMinutes: 30,
    });
    expectCompletion(true);
  });

  it("builds an agentic review from the head branch and SHA range", async () => {
    await run({ diffMode: "agentic" });
    expect(session).toHaveBeenCalledExactlyOnceWith({
      apiKey: "api-key",
      prompt: expect.stringContaining("git diff baseSHA...headSHA"),
      source: { github: "owner/repo", baseBranch: "feature" },
      title: "Code Review (Agentic)",
      timeoutMinutes: 30,
    });
    expectCompletion(true);
  });

  it("retries a prompt timeout once with the same prompt, source, and full budget", async () => {
    session.mockResolvedValueOnce({ kind: "timeout", sessionId: "timed-out" });
    const result = await run();
    expect(result.sessionId).toBe("s1");
    expect(session).toHaveBeenCalledTimes(2);
    expect(session.mock.calls[0]).toEqual(session.mock.calls[1]);
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"jules_retry"')
    );
    expectCompletion(true);
  });

  it("returns the last session on exhausted timeouts and reports failure", async () => {
    session
      .mockResolvedValueOnce({ kind: "timeout", sessionId: "first" })
      .mockResolvedValueOnce({ kind: "timeout", sessionId: "second" });
    expect(await run()).toMatchObject({
      reviewResult: null,
      sessionId: "second",
    });
    expect(session).toHaveBeenCalledTimes(2);
    expect(core.error).toHaveBeenCalledWith(
      expect.stringContaining("session first and retry session second")
    );
    expectCompletion(false);
  });

  it.each(["prompt", "agentic"] as const)(
    "does not retry an unparseable %s review",
    async (diffMode) => {
      session.mockResolvedValue({
        kind: "review",
        reviewResult: { ...reviewResult, verdict: "block", unparseable: true },
        sessionId: "parse-failure",
      });
      expect((await run({ diffMode })).reviewResult?.unparseable).toBe(true);
      expect(session).toHaveBeenCalledOnce();
      expectCompletion(false);
    }
  );

  it.each([
    new Error("creation failed"),
    new AuthError("auth"),
    new QuotaExceededError("quota"),
  ])("propagates prompt creation failures without retry: %s", async (error) => {
    session.mockResolvedValue({
      kind: "creation_failed",
      sessionId: "",
      error,
    });
    await expect(run()).rejects.toBe(error);
    expect(session).toHaveBeenCalledOnce();
    expectCompletion(false);
  });

  it.each([
    new Error("readiness failed"),
    new AuthError("auth"),
    new QuotaExceededError("quota"),
  ])(
    "does not fall back or retry thrown lifecycle errors: %s",
    async (error) => {
      session.mockRejectedValue(error);
      await expect(run({ diffMode: "agentic" })).rejects.toBe(error);
      expect(session).toHaveBeenCalledOnce();
      expectCompletion(false);
    }
  );

  it.each([
    new Error("creation failed"),
    new AuthError("creation auth failure"),
  ])(
    "preserves prompt fallback on agentic creation failure: %s",
    async (error) => {
      session.mockResolvedValueOnce({
        kind: "creation_failed",
        sessionId: "",
        error,
      });
      const result = await run({ diffMode: "agentic" });
      expect(result.reviewResult).toEqual(reviewResult);
      expect(session).toHaveBeenCalledTimes(2);
      expect(session.mock.calls[1][0].source).toEqual({
        github: "owner/repo",
        baseBranch: "main",
      });
      expect(logStructured).toHaveBeenCalledWith("agentic_fallback", {
        reason: "session_creation_failed",
        error: error.message,
      });
      expectCompletion(true);
    }
  );

  it("does not fall back on agentic creation quota exhaustion", async () => {
    const error = new QuotaExceededError("quota");
    session.mockResolvedValue({
      kind: "creation_failed",
      sessionId: "",
      error,
    });
    await expect(run({ diffMode: "agentic" })).rejects.toBe(error);
    expect(session).toHaveBeenCalledOnce();
    expect(logStructured).not.toHaveBeenCalledWith(
      "agentic_fallback",
      expect.anything()
    );
    expectCompletion(false);
  });

  it("includes agentic time, fallback, and prompt retry in one completion", async () => {
    session
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { kind: "timeout", sessionId: "agentic" };
      })
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { kind: "timeout", sessionId: "prompt-first" };
      })
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { kind: "review", reviewResult, sessionId: "prompt-second" };
      });
    const result = run({ diffMode: "agentic" });
    await vi.advanceTimersByTimeAsync(600);
    expect((await result).sessionId).toBe("prompt-second");
    expect(session).toHaveBeenCalledTimes(3);
    expect(session.mock.calls[1]).toEqual(session.mock.calls[2]);
    expectCompletion(true, 600);
  });

  it.each([
    { changedFiles: undefined, tier: "empty" },
    { changedFiles: [], tier: "empty" },
    { changedFiles: ["other.ts"], tier: "partial" },
    { changedFiles: ["src/a.ts", "other.ts"], tier: "extra_only" },
  ])(
    "keeps $tier verification informational",
    async ({ changedFiles, tier }) => {
      session.mockResolvedValue({
        kind: "review",
        reviewResult: { ...reviewResult, changedFiles },
        sessionId: "s1",
      });
      const result = await run({ diffMode: "agentic" });
      expect(result.sessionId).toBe("s1");
      expect(session).toHaveBeenCalledOnce();
      expect(logStructured).toHaveBeenCalledWith("verification_mismatch", {
        tier,
        reportedCount: changedFiles?.length ?? 0,
        actualCount: 1,
      });
      expectCompletion(true);
    }
  );

  it("accepts a matching file report without mismatch diagnostics", async () => {
    session.mockResolvedValue({
      kind: "review",
      reviewResult: { ...reviewResult, changedFiles: ["src/a.ts"] },
      sessionId: "s1",
    });
    await run({ diffMode: "agentic" });
    expect(core.warning).not.toHaveBeenCalled();
    expect(logStructured).not.toHaveBeenCalledWith(
      "verification_mismatch",
      expect.anything()
    );
  });

  it("deduplicates the large agentic coverage total", async () => {
    await run(
      { diffMode: "agentic", largePrThreshold: 1 },
      { ...prepared, changedFiles: ["src/a.ts", "src/a.ts"] }
    );
    expect(session.mock.calls[0][0].prompt).toContain(
      "Reviewed X of 1 changed files"
    );
  });

  it("returns deterministic prompt coverage", async () => {
    const result = await run({ largePrThreshold: 30 });
    expect(result.reviewCoverage).toMatchObject({
      isLarge: true,
      totalFiles: 1,
      reviewedFiles: 1,
    });
    expect(session.mock.calls[0][0].prompt).toContain("# Large PR — coverage");
  });

  it("accepts missing PR title and description", async () => {
    await executeReview(
      "api-key",
      42,
      { head: { ref: "feature" }, base: { ref: "main" } },
      prepared,
      "owner/repo",
      "baseSHA",
      "headSHA",
      config
    );
    expect(session).toHaveBeenCalledOnce();
  });
});
