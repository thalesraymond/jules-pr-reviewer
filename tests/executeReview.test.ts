import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeReview } from "../src/executeReview.js";

const mockBuildReviewPrompt = vi.fn();
const mockRunJulesReview = vi.fn();
const mockRunAgenticReview = vi.fn();
const mockPreparePromptDiff = vi.fn();
const mockLogStructured = vi.fn();

vi.mock("../src/prompt.js", () => ({
  buildReviewPrompt: (...args: unknown[]) => mockBuildReviewPrompt(...args),
}));

vi.mock("../src/jules.js", () => ({
  runJulesReview: (...args: unknown[]) => mockRunJulesReview(...args),
  runAgenticReview: (...args: unknown[]) => mockRunAgenticReview(...args),
}));

vi.mock("../src/coverage.js", () => ({
  preparePromptDiff: (...args: unknown[]) => mockPreparePromptDiff(...args),
  buildPostedCoverageNote: vi.fn(),
}));

vi.mock("../src/logging.js", () => ({
  logStructured: (...args: unknown[]) => mockLogStructured(...args),
}));

const baseConfig = {
  diffMode: "prompt" as const,
  ignoredPaths: undefined as string | undefined,
  extraInstructions: undefined as string | undefined,
  dedupe: true,
  strictness: "chill" as const,
  largePrThreshold: 80_000,
  largePrStrategy: "prioritize" as const,
  timeoutMinutes: 30,
};

const basePrepared = {
  diff: "filtered diff",
  changedFiles: ["src/a.ts"],
  rulesFromFile: undefined as string | undefined,
  perPathRules: [] as Array<{ path: string; glob: string; content: string }>,
  openThreads: [] as Array<{
    index: number;
    threadId: string;
    path: string;
    line: number;
    body: string;
  }>,
};

const reviewResult = {
  verdict: "comment" as const,
  summary: "Looks good",
  resolvedCommentIds: [],
  newComments: [],
};

describe("executeReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildReviewPrompt.mockReturnValue("prompt text");
    mockPreparePromptDiff.mockReturnValue({
      diff: "prepared diff",
      diffTruncatedNote: undefined,
      coverage: { isLarge: false, totalFiles: 1 },
    });
    mockRunJulesReview.mockResolvedValue({
      reviewResult,
      sessionId: "prompt-session",
    });
    mockRunAgenticReview.mockResolvedValue({
      reviewResult,
      sessionId: "agentic-session",
      fallback: false,
    });
  });

  it("runs the prompt pipeline by default", async () => {
    const result = await executeReview(
      "apiKey",
      42,
      {
        title: "PR Title",
        body: "PR Body",
        head: { ref: "feature" },
        base: { ref: "main" },
      },
      basePrepared,
      "owner/repo",
      "baseSHA",
      "headSHA",
      baseConfig
    );

    expect(mockPreparePromptDiff).toHaveBeenCalledWith(
      "filtered diff",
      80_000,
      "prioritize"
    );
    expect(mockBuildReviewPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "prompt" })
    );
    expect(mockRunJulesReview).toHaveBeenCalledWith(
      "apiKey",
      "prompt text",
      { github: "owner/repo", baseBranch: "main" },
      30
    );
    expect(result).toMatchObject({
      reviewResult,
      sessionId: "prompt-session",
      julesApiDuration: expect.any(Number),
    });
    expect(mockLogStructured).toHaveBeenCalledWith(
      "jules_api_called",
      expect.objectContaining({ success: true })
    );
  });

  it("runs the agentic pipeline when diff_mode is agentic", async () => {
    const result = await executeReview(
      "apiKey",
      42,
      {
        title: "PR Title",
        body: "PR Body",
        head: { ref: "feature" },
        base: { ref: "main" },
      },
      basePrepared,
      "owner/repo",
      "baseSHA",
      "headSHA",
      { ...baseConfig, diffMode: "agentic" }
    );

    expect(mockBuildReviewPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "agentic" })
    );
    expect(mockRunAgenticReview).toHaveBeenCalledWith(
      "apiKey",
      "prompt text",
      { github: "owner/repo", baseBranch: "feature" },
      30,
      ["src/a.ts"]
    );
    expect(result).toMatchObject({
      reviewResult,
      sessionId: "agentic-session",
    });
  });

  it("falls back to prompt pipeline when agentic review falls back", async () => {
    mockRunAgenticReview.mockResolvedValue({
      reviewResult: null,
      sessionId: "agentic-session",
      fallback: true,
    });

    const result = await executeReview(
      "apiKey",
      42,
      {
        title: "PR Title",
        body: "PR Body",
        head: { ref: "feature" },
        base: { ref: "main" },
      },
      basePrepared,
      "owner/repo",
      "baseSHA",
      "headSHA",
      { ...baseConfig, diffMode: "agentic" }
    );

    expect(mockRunAgenticReview).toHaveBeenCalled();
    expect(mockRunJulesReview).toHaveBeenCalled();
    expect(result.reviewResult).toEqual(reviewResult);
    expect(result.sessionId).toBe("prompt-session");
  });

  it("passes coverage from prompt diff preparation", async () => {
    mockPreparePromptDiff.mockReturnValue({
      diff: "prepared diff",
      diffTruncatedNote: "truncated",
      coverage: { isLarge: true, totalFiles: 5, reviewedFiles: 3 },
    });

    const result = await executeReview(
      "apiKey",
      42,
      {
        title: "PR Title",
        body: "PR Body",
        head: { ref: "feature" },
        base: { ref: "main" },
      },
      basePrepared,
      "owner/repo",
      "baseSHA",
      "headSHA",
      baseConfig
    );

    expect(result.reviewCoverage).toEqual({
      isLarge: true,
      totalFiles: 5,
      reviewedFiles: 3,
    });
  });
});
