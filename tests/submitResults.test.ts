import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitResults } from "../src/submitResults.js";

const mockSubmitReview = vi.fn();
const mockResolveThreads = vi.fn();
const mockFinalizeCheckRun = vi.fn();
const mockSetReviewOutputs = vi.fn();
const mockLogStructured = vi.fn();
const mockFilterCommentsBySeverity = vi.fn();
const mockFilterCommentsByStrictness = vi.fn();
const mockConclusionFromVerdict = vi.fn();
const mockConclusionFromFindings = vi.fn();
const mockBuildAnnotations = vi.fn();
const mockBuildPostedCoverageNote = vi.fn();

vi.mock("../src/submission.js", () => ({
  submitReview: (...args: unknown[]) => mockSubmitReview(...args),
  buildAnnotations: (...args: unknown[]) => mockBuildAnnotations(...args),
}));

vi.mock("../src/github.js", () => ({
  resolveThreads: (...args: unknown[]) => mockResolveThreads(...args),
  finalizeCheckRun: (...args: unknown[]) => mockFinalizeCheckRun(...args),
}));

vi.mock("../src/logging.js", () => ({
  setReviewOutputs: (...args: unknown[]) => mockSetReviewOutputs(...args),
  logStructured: (...args: unknown[]) => mockLogStructured(...args),
}));

vi.mock("../src/severity.js", () => ({
  filterCommentsBySeverity: (...args: unknown[]) =>
    mockFilterCommentsBySeverity(...args),
  conclusionFromVerdict: (...args: unknown[]) =>
    mockConclusionFromVerdict(...args),
  conclusionFromFindings: (...args: unknown[]) =>
    mockConclusionFromFindings(...args),
}));

vi.mock("../src/strictness.js", () => ({
  filterCommentsByStrictness: (...args: unknown[]) =>
    mockFilterCommentsByStrictness(...args),
}));

vi.mock("../src/coverage.js", () => ({
  buildPostedCoverageNote: (...args: unknown[]) =>
    mockBuildPostedCoverageNote(...args),
}));

const baseConfig = {
  enableSuggestions: false,
  enableApprove: false,
  minSeverityToReport: "Info" as const,
  strictness: "chill" as const,
  failOn: "any" as const,
  statusContext: "Jules Review",
};

const octokit = { rest: {} } as unknown as ReturnType<
  typeof import("@actions/github").getOctokit
>;

const baseReviewResult = {
  verdict: "comment" as const,
  summary: "Summary",
  resolvedCommentIds: [] as number[],
  newComments: [] as Array<{
    file: string;
    line: number;
    severity: "High" | "Warning" | "Info";
    confidence: "Low" | "Medium" | "High";
    message: string;
    promptForAgents: string;
  }>,
};

describe("submitResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFilterCommentsBySeverity.mockImplementation((comments) => comments);
    mockFilterCommentsByStrictness.mockImplementation((comments) => comments);
    mockConclusionFromVerdict.mockReturnValue({
      conclusion: "success" as const,
      description: "Review complete",
    });
    mockConclusionFromFindings.mockReturnValue({
      conclusion: "failure" as const,
      description: "Findings found",
    });
    mockBuildAnnotations.mockReturnValue([]);
    mockBuildPostedCoverageNote.mockReturnValue("");
    mockSubmitReview.mockResolvedValue({
      state: "inline_without_suggestions",
      degraded: false,
    });
    mockFinalizeCheckRun.mockResolvedValue(undefined);
  });

  it("submits a review and finalizes the check run", async () => {
    await submitResults(
      octokit,
      "owner",
      "repo",
      1,
      "headSHA",
      42,
      baseReviewResult,
      undefined,
      [],
      "session-id",
      baseConfig,
      Date.now()
    );

    expect(mockSubmitReview).toHaveBeenCalled();
    expect(mockFinalizeCheckRun).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      42,
      "success",
      expect.objectContaining({ title: "Jules Review" })
    );
    expect(mockSetReviewOutputs).toHaveBeenCalled();
    expect(mockLogStructured).toHaveBeenCalledWith(
      "review_completed",
      expect.any(Object)
    );
  });

  it("resolves threads when resolvedCommentIds are provided", async () => {
    await submitResults(
      octokit,
      "owner",
      "repo",
      1,
      "headSHA",
      42,
      {
        ...baseReviewResult,
        resolvedCommentIds: [1],
      },
      undefined,
      [{ index: 1, threadId: "t1", path: "a.ts", line: 1, body: "old" }],
      "session-id",
      baseConfig,
      Date.now()
    );

    expect(mockResolveThreads).toHaveBeenCalledWith(octokit, ["t1"]);
  });

  it("uses conclusionFromFindings when block_on is set", async () => {
    await submitResults(
      octokit,
      "owner",
      "repo",
      1,
      "headSHA",
      42,
      baseReviewResult,
      undefined,
      [],
      "session-id",
      { ...baseConfig, blockOn: "High" },
      Date.now()
    );

    expect(mockConclusionFromFindings).toHaveBeenCalled();
    expect(mockConclusionFromVerdict).not.toHaveBeenCalled();
  });

  it("uses conclusionFromVerdict when block_on is not set", async () => {
    await submitResults(
      octokit,
      "owner",
      "repo",
      1,
      "headSHA",
      42,
      baseReviewResult,
      undefined,
      [],
      "session-id",
      baseConfig,
      Date.now()
    );

    expect(mockConclusionFromVerdict).toHaveBeenCalledWith("comment", "any");
    expect(mockConclusionFromFindings).not.toHaveBeenCalled();
  });

  it("strips suggestions when enable_suggestions is false", async () => {
    const comments = [
      {
        file: "a.ts",
        line: 1,
        severity: "High" as const,
        confidence: "High" as const,
        message: "Bug",
        promptForAgents: "",
        suggestion: "fix",
        startLine: 1,
      },
    ];
    mockFilterCommentsByStrictness.mockReturnValue(comments);

    await submitResults(
      octokit,
      "owner",
      "repo",
      1,
      "headSHA",
      42,
      { ...baseReviewResult, newComments: comments },
      undefined,
      [],
      "session-id",
      baseConfig,
      Date.now()
    );

    const submittedComments = mockSubmitReview.mock.calls[0][6];
    expect(submittedComments[0]).not.toHaveProperty("suggestion");
    expect(submittedComments[0]).not.toHaveProperty("startLine");
  });

  it("discloses degraded suggestion delivery in the check run and logs", async () => {
    mockSubmitReview.mockResolvedValue({
      state: "inline_without_suggestions",
      degraded: true,
      loss: "suggestions_omitted",
    });

    await submitResults(
      octokit,
      "owner",
      "repo",
      1,
      "headSHA",
      42,
      baseReviewResult,
      undefined,
      [],
      "session-id",
      baseConfig,
      Date.now()
    );

    expect(mockFinalizeCheckRun).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      42,
      "success",
      expect.objectContaining({
        summary: expect.stringContaining(
          "GitHub rejected the suggested changes"
        ),
      })
    );
    expect(mockLogStructured).toHaveBeenCalledWith(
      "review_submitted",
      expect.objectContaining({
        delivery: "inline_without_suggestions",
        degraded: true,
        deliveryLoss: "suggestions_omitted",
      })
    );
  });

  it("keeps counts, verdict, annotations, and event when summary-only fallback loses findings", async () => {
    const comments = [
      {
        file: "a.ts",
        line: 1,
        severity: "High" as const,
        confidence: "High" as const,
        message: "Bug",
        promptForAgents: "",
      },
      {
        file: "b.ts",
        line: 2,
        severity: "Info" as const,
        confidence: "Low" as const,
        message: "Nit",
        promptForAgents: "",
      },
    ];
    const annotations = [
      {
        path: "a.ts",
        startLine: 1,
        endLine: 1,
        annotationLevel: "failure" as const,
        message: "Bug",
      },
    ];
    mockFilterCommentsByStrictness.mockReturnValue(comments);
    mockBuildAnnotations.mockReturnValue(annotations);
    mockSubmitReview.mockResolvedValue({
      state: "summary_only",
      degraded: true,
      loss: "inline_findings_omitted",
    });

    await submitResults(
      octokit,
      "owner",
      "repo",
      1,
      "headSHA",
      42,
      { ...baseReviewResult, newComments: comments },
      undefined,
      [],
      "session-id",
      baseConfig,
      Date.now()
    );

    expect(mockSubmitReview.mock.calls[0][6]).toHaveLength(2);
    expect(mockSubmitReview.mock.calls[0][7]).toBe("COMMENT");
    expect(mockBuildAnnotations).toHaveBeenCalledWith(comments);
    expect(mockConclusionFromVerdict).toHaveBeenCalledWith("comment", "any");
    expect(mockSetReviewOutputs).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: "comment",
        issues_count: 2,
        high_issues_count: 1,
        info_issues_count: 1,
      })
    );
    expect(mockFinalizeCheckRun).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      42,
      "success",
      expect.objectContaining({
        summary: expect.stringContaining("GitHub rejected inline comments"),
        annotations,
      })
    );
    expect(mockLogStructured).toHaveBeenCalledWith(
      "review_submitted",
      expect.objectContaining({
        delivery: "summary_only",
        degraded: true,
        deliveryLoss: "inline_findings_omitted",
      })
    );
    expect(mockLogStructured).toHaveBeenCalledWith(
      "review_completed",
      expect.objectContaining({
        delivery: "summary_only",
        degraded: true,
        deliveryLoss: "inline_findings_omitted",
      })
    );
  });

  it("does not disclose fallback when delivery is not degraded", async () => {
    await submitResults(
      octokit,
      "owner",
      "repo",
      1,
      "headSHA",
      42,
      baseReviewResult,
      undefined,
      [],
      "session-id",
      baseConfig,
      Date.now()
    );

    expect(mockFinalizeCheckRun).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      42,
      "success",
      expect.objectContaining({ summary: "Review complete" })
    );
    expect(mockLogStructured).toHaveBeenCalledWith(
      "review_submitted",
      expect.objectContaining({
        delivery: "inline_without_suggestions",
        degraded: false,
      })
    );
  });

  it("treats an intentional summary-only review without findings as normal", async () => {
    mockSubmitReview.mockResolvedValue({
      state: "summary_only",
      degraded: false,
    });

    await submitResults(
      octokit,
      "owner",
      "repo",
      1,
      "headSHA",
      42,
      baseReviewResult,
      undefined,
      [],
      "session-id",
      baseConfig,
      Date.now()
    );

    expect(mockFinalizeCheckRun).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      42,
      "success",
      expect.objectContaining({ summary: "Review complete" })
    );
    expect(mockLogStructured).toHaveBeenCalledWith(
      "review_completed",
      expect.objectContaining({
        delivery: "summary_only",
        degraded: false,
      })
    );
  });
});
