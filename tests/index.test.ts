/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as core from "@actions/core";
import * as github from "@actions/github";

// Mock dependencies
vi.mock("@actions/core");
vi.mock("@actions/github");

// We need to import the action file in a way that doesn't trigger the run() immediately,
// but since it runs immediately, we can mock everything first, then dynamically import it.
// We'll reset modules before each test.

describe("index.ts", () => {
  let mockGetInput: any;
  let mockSetFailed: any;
  let mockSetSecret: any;
  let mockGetBooleanInput: any;
  let mockInfo: any;
  let mockOctokit: any;

  // mock sub-modules
  const mockGithubHelper = {
    fetchDiff: vi.fn(),
    loadRulesFromBase: vi.fn(),
    fetchOpenThreads: vi.fn(),
    resolveThreads: vi.fn(),
    setStatus: vi.fn(),
  };

  const mockSubmissionHelper = {
    submitReview: vi.fn(),
  };

  const mockJulesHelper = {
    runJulesReview: vi.fn(),
    runAgenticReview: vi.fn(),
    wrapPermissionError: vi.fn(),
  };

  const mockLoggingHelper = {
    logStructured: vi.fn(),
    setReviewOutputs: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    mockGetInput = vi.spyOn(core, "getInput");
    mockGetBooleanInput = vi.spyOn(core, "getBooleanInput");
    mockSetFailed = vi.spyOn(core, "setFailed");
    mockSetSecret = vi.spyOn(core, "setSecret");
    mockInfo = vi.spyOn(core, "info");

    // Default inputs
    mockGetInput.mockImplementation((name: string) => {
      if (name === "jules_api_key") return "dummy_key";
      if (name === "github_token") return "dummy_token";
      if (name === "fail_on") return "any";
      if (name === "timeout_minutes") return "30";
      if (name === "enable_suggestions") return "false";
      return "";
    });
    mockGetBooleanInput.mockReturnValue(false);

    mockOctokit = {
      rest: { pulls: {}, repos: {} },
    };
    (github as any).getOctokit = vi.fn().mockReturnValue(mockOctokit);

    // Default context
    (github as any).context = {
      eventName: "pull_request",
      repo: { owner: "owner", repo: "repo" },
      payload: {
        action: "opened",
        pull_request: {
          number: 1,
          head: {
            sha: "headSHA",
            ref: "feature",
            repo: { full_name: "owner/repo" },
          },
          base: { sha: "baseSHA", ref: "main" },
          title: "PR Title",
          body: "PR Body",
          labels: [],
        },
      },
    };

    // mock helpers
    vi.doMock("../src/github.js", () => mockGithubHelper);
    vi.doMock("../src/submission.js", () => mockSubmissionHelper);
    vi.doMock("../src/jules.js", () => mockJulesHelper);
    vi.doMock("../src/logging.js", () => mockLoggingHelper);

    // default helper returns
    mockGithubHelper.fetchDiff.mockResolvedValue("diff");
    mockGithubHelper.fetchOpenThreads.mockResolvedValue([]);
    mockGithubHelper.setStatus.mockResolvedValue(undefined);
    mockSubmissionHelper.submitReview.mockResolvedValue(undefined);
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "approve",
        summary: "Good job",
        newComments: [],
      },
      sessionId: "session-id",
    });
    mockJulesHelper.wrapPermissionError.mockImplementation((e: any) => e);
  });

  const loadIndex = async () => {
    await import("../src/index.js");
    // Allow promises to flush
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("masks secrets explicitly", async () => {
    await loadIndex();
    expect(mockSetSecret).toHaveBeenCalledWith("dummy_key");
    expect(mockSetSecret).toHaveBeenCalledWith("dummy_token");
  });

  it("fails if eventName is pull_request_target", async () => {
    (github as any).context.eventName = "pull_request_target";
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("pull_request_target is not supported")
    );
  });

  it("fails if eventName is not pull_request", async () => {
    (github as any).context.eventName = "push";
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Unsupported event")
    );
  });

  it("fails if no pull_request payload", async () => {
    (github as any).context.payload.pull_request = undefined;
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith(
      "No pull_request payload found."
    );
  });

  it("fails if fail_on is invalid", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "fail_on") return "invalid";
      return "";
    });
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Invalid fail_on")
    );
  });

  it("skips draft PR if skip_drafts is true", async () => {
    (github as any).context.payload.pull_request.draft = true;
    mockGetBooleanInput.mockImplementation(
      (name: string) => name === "skip_drafts"
    );
    await loadIndex();
    expect(mockInfo).toHaveBeenCalledWith("Skipping draft PR.");
  });

  it("skips fork PR if skip_forks is true", async () => {
    (github as any).context.payload.pull_request.head.repo.full_name =
      "fork/repo";
    mockGetBooleanInput.mockImplementation(
      (name: string) => name === "skip_forks"
    );
    await loadIndex();
    expect(mockInfo).toHaveBeenCalledWith(
      "Skipping fork PR (skip_forks=true)."
    );
  });

  it("skips if bypass label is present", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "jules_api_key") return "k";
      if (name === "github_token") return "t";
      if (name === "fail_on") return "any";
      if (name === "bypass_label") return "skip-review";
      return "";
    });
    (github as any).context.payload.pull_request.labels = [
      { name: "skip-review" },
    ];
    await loadIndex();
    expect(mockInfo).toHaveBeenCalledWith(
      'Bypass label "skip-review" present — skipping review.'
    );
  });

  it("uses ctx.payload.before for diff on synchronize event", async () => {
    (github as any).context.payload.action = "synchronize";
    (github as any).context.payload.before = "beforeSHA";
    await loadIndex();
    expect(mockGithubHelper.fetchDiff).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      expect.anything(),
      "beforeSHA",
      "headSHA"
    );
  });

  it("loads rules if rules_file is provided", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "rules_file") return "rules.md";
      if (name === "jules_api_key") return "k";
      if (name === "github_token") return "t";
      if (name === "fail_on") return "any";
      return "";
    });
    mockGithubHelper.loadRulesFromBase.mockResolvedValue("project rules");
    await loadIndex();
    expect(mockGithubHelper.loadRulesFromBase).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      "rules.md",
      "baseSHA"
    );
  });

  it("truncates large diffs", async () => {
    const hugeDiff = "x".repeat(81_000);
    mockGithubHelper.fetchDiff.mockResolvedValue(hugeDiff);
    await loadIndex();
    // Verify prompt contains truncation note
    expect(mockJulesHelper.runJulesReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(
        "NOTE: The diff was truncated: original 81000 chars, kept first 80000."
      ),
      expect.anything(),
      expect.anything()
    );
  });

  it("filters diff using ignored_paths before passing to Jules", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "ignored_paths") return '["dist/**"]';
      if (name === "jules_api_key") return "k";
      if (name === "github_token") return "t";
      if (name === "fail_on") return "any";
      return "";
    });

    const diffWithDist = `diff --git a/src/index.ts b/src/index.ts
index 123..456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1 @@
-old
+new
diff --git a/dist/index.js b/dist/index.js
index 789..abc 100644
--- a/dist/index.js
+++ b/dist/index.js
@@ -1 +1 @@
-old dist
+new dist`;

    mockGithubHelper.fetchDiff.mockResolvedValue(diffWithDist);
    await loadIndex();

    expect(mockJulesHelper.runJulesReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("src/index.ts"),
      expect.anything(),
      expect.anything()
    );
    expect(mockJulesHelper.runJulesReview).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("dist/index.js"),
      expect.anything(),
      expect.anything()
    );
  });

  it("fails if diff_mode is invalid", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "diff_mode") return "bogus";
      if (name === "fail_on") return "any";
      if (name === "jules_api_key") return "k";
      if (name === "github_token") return "t";
      return "";
    });
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid diff_mode: "bogus"')
    );
    expect(mockJulesHelper.runJulesReview).not.toHaveBeenCalled();
    expect(mockJulesHelper.runAgenticReview).not.toHaveBeenCalled();
  });

  it("runs the prompt pipeline when diff_mode is prompt", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "diff_mode") return "prompt";
      if (name === "jules_api_key") return "k";
      if (name === "github_token") return "t";
      if (name === "fail_on") return "any";
      return "";
    });
    await loadIndex();
    expect(mockJulesHelper.runJulesReview).toHaveBeenCalledTimes(1);
    expect(mockJulesHelper.runAgenticReview).not.toHaveBeenCalled();
  });

  it("runs the agentic pipeline when diff_mode is agentic", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "diff_mode") return "agentic";
      if (name === "jules_api_key") return "k";
      if (name === "github_token") return "t";
      if (name === "fail_on") return "any";
      return "";
    });
    mockGithubHelper.fetchDiff
      .mockResolvedValue(`diff --git a/src/index.ts b/src/index.ts
index 123..456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/utils.ts b/src/utils.ts
index 789..abc 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1 +1 @@
-old
+new`);
    mockJulesHelper.runAgenticReview.mockResolvedValue({
      reviewResult: {
        verdict: "approve",
        summary: "ok",
        newComments: [],
        changedFiles: ["src/index.ts", "src/utils.ts"],
      },
      sessionId: "agentic-session",
      fallback: false,
    });

    await loadIndex();

    expect(mockJulesHelper.runAgenticReview).toHaveBeenCalledTimes(1);
    expect(mockJulesHelper.runJulesReview).not.toHaveBeenCalled();
    const agenticCall = mockJulesHelper.runAgenticReview.mock.calls[0];
    expect(agenticCall[1]).toContain("git diff baseSHA...headSHA");
    expect(agenticCall[2]).toEqual({
      github: "owner/repo",
      baseBranch: "feature",
    });
    expect(agenticCall[4]).toEqual(["src/index.ts", "src/utils.ts"]);
    expect(mockSubmissionHelper.submitReview).toHaveBeenCalledTimes(1);
  });

  it("uses the full base SHA for the changed-file set in agentic mode on synchronize", async () => {
    (github as any).context.payload.action = "synchronize";
    (github as any).context.payload.before = "beforeSHA";
    mockGetInput.mockImplementation((name: string) => {
      if (name === "diff_mode") return "agentic";
      if (name === "jules_api_key") return "k";
      if (name === "github_token") return "t";
      if (name === "fail_on") return "any";
      return "";
    });
    mockJulesHelper.runAgenticReview.mockResolvedValue({
      reviewResult: {
        verdict: "approve",
        summary: "ok",
        newComments: [],
      },
      sessionId: "s1",
      fallback: false,
    });
    await loadIndex();
    expect(mockGithubHelper.fetchDiff).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      expect.anything(),
      "baseSHA",
      "headSHA"
    );
  });

  it("falls back to the prompt pipeline when agentic review falls back", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "diff_mode") return "agentic";
      if (name === "jules_api_key") return "k";
      if (name === "github_token") return "t";
      if (name === "fail_on") return "any";
      return "";
    });
    mockJulesHelper.runAgenticReview.mockResolvedValue({
      reviewResult: null,
      sessionId: "abandoned-session",
      fallback: true,
      fallbackReason: "timeout",
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "comment",
        summary: "prompt fallback ok",
        newComments: [],
      },
      sessionId: "prompt-session",
    });

    await loadIndex();

    expect(mockJulesHelper.runAgenticReview).toHaveBeenCalledTimes(1);
    expect(mockJulesHelper.runJulesReview).toHaveBeenCalledTimes(1);
    expect(mockSubmissionHelper.submitReview).toHaveBeenCalledTimes(1);
    expect(mockSubmissionHelper.submitReview).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      1,
      "headSHA",
      expect.stringContaining("prompt-session"),
      expect.anything()
    );
  });

  it("handles Jules failure to return review", async () => {
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: null,
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.setStatus).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      "headSHA",
      expect.anything(),
      "error",
      "Jules did not return a valid review in time"
    );
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Jules returned no review message")
    );
  });

  it("resolves open threads if resolvedCommentIds provided", async () => {
    mockGithubHelper.fetchOpenThreads.mockResolvedValue([
      { index: 1, threadId: "t1" },
      { index: 2, threadId: "t2" },
    ]);
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "approve",
        summary: "ok",
        resolvedCommentIds: [2],
      },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.resolveThreads).toHaveBeenCalledWith(
      expect.anything(),
      ["t2"]
    );
  });

  it("submits review and sets status based on verdict", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "fail_on") return "blocking";
      return "";
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: { verdict: "block", summary: "bad", newComments: [] },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockSubmissionHelper.submitReview).toHaveBeenCalled();
    expect(mockGithubHelper.setStatus).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      "headSHA",
      expect.anything(),
      "failure",
      "Blocking issues found"
    );
  });

  it("handles fail_on = never", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "fail_on") return "never";
      if (name === "jules_api_key") return "k";
      if (name === "github_token") return "t";
      return "";
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: { verdict: "block", summary: "bad", newComments: [] },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.setStatus).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      "headSHA",
      expect.anything(),
      "success",
      "Review complete (verdict: block)"
    );
  });

  it("handles fail_on = any with approve verdict", async () => {
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: { verdict: "approve", summary: "ok", newComments: [] },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.setStatus).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      "headSHA",
      expect.anything(),
      "success",
      "Approved"
    );
  });

  it("strips suggestion fields when enable_suggestions is false (default)", async () => {
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "approve",
        summary: "ok",
        newComments: [
          {
            file: "a.ts",
            line: 10,
            startLine: 8,
            severity: "High",
            confidence: "High",
            message: "Msg",
            promptForAgents: "",
            suggestion: "const x = 1;",
          },
        ],
      },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockSubmissionHelper.submitReview).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      1,
      "headSHA",
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          file: "a.ts",
          line: 10,
          severity: "High",
          confidence: "High",
          message: "Msg",
          promptForAgents: "",
        }),
      ])
    );
    const submittedComments =
      mockSubmissionHelper.submitReview.mock.calls[0][6];
    expect(submittedComments[0]).not.toHaveProperty("suggestion");
    expect(submittedComments[0]).not.toHaveProperty("startLine");
  });

  it("forwards suggestion fields when enable_suggestions is true", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "enable_suggestions") return "true";
      if (name === "jules_api_key") return "dummy_key";
      if (name === "github_token") return "dummy_token";
      if (name === "fail_on") return "any";
      if (name === "timeout_minutes") return "30";
      return "";
    });
    mockGetBooleanInput.mockImplementation(
      (name: string) => name === "enable_suggestions"
    );
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "approve",
        summary: "ok",
        newComments: [
          {
            file: "a.ts",
            line: 10,
            startLine: 8,
            severity: "High",
            confidence: "High",
            message: "Msg",
            promptForAgents: "",
            suggestion: "const x = 1;",
          },
        ],
      },
      sessionId: "s1",
    });
    await loadIndex();
    const submittedComments =
      mockSubmissionHelper.submitReview.mock.calls[0][6];
    expect(submittedComments[0]).toHaveProperty("suggestion", "const x = 1;");
    expect(submittedComments[0]).toHaveProperty("startLine", 8);
  });

  it("fails immediately when initial setStatus throws permission error", async () => {
    mockGithubHelper.setStatus.mockRejectedValueOnce(
      new Error("Initial setStatus failed")
    );
    mockJulesHelper.wrapPermissionError.mockReturnValueOnce(
      new Error("Wrapped initial setStatus failed")
    );
    await loadIndex();
    // It should have caught the error, wrapped it, and then caught it in the top level catch.
    expect(mockSetFailed).toHaveBeenCalledWith(
      "Jules PR review failed: Wrapped initial setStatus failed"
    );
  });

  it("top-level catch works when run throws synchronously", async () => {
    // If core.getInput throws, run() will reject before async things
    mockGetInput.mockImplementation(() => {
      throw new Error("Sync error");
    });
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith("Sync error");
  });

  it("top-level catch handles non-Error objects", async () => {
    mockGetInput.mockImplementation(() => {
      throw "String error";
    });
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith("String error");
  });

  it("handles exception in the process", async () => {
    mockGithubHelper.fetchDiff.mockRejectedValue(
      new Error("Fetch diff failed")
    );
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith(
      "Jules PR review failed: Fetch diff failed"
    );
    expect(mockGithubHelper.setStatus).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      "headSHA",
      expect.anything(),
      "error",
      "Review failed. Check GitHub Actions log for details."
    );
  });

  it("emits review_started log on successful start", async () => {
    await loadIndex();
    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_started",
      expect.objectContaining({
        repoOwner: "owner",
        repoName: "repo",
        prNumber: 1,
        headSha: "headSHA",
      })
    );
  });

  it("emits review_completed log with issue counts", async () => {
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "comment",
        summary: "Found 2 issues",
        newComments: [
          {
            file: "a.ts",
            line: 1,
            severity: "High",
            confidence: "High",
            message: "Issue 1",
            promptForAgents: "",
          },
          {
            file: "b.ts",
            line: 2,
            severity: "Warning",
            confidence: "Medium",
            message: "Issue 2",
            promptForAgents: "",
          },
          {
            file: "c.ts",
            line: 3,
            severity: "Info",
            confidence: "Low",
            message: "Issue 3",
            promptForAgents: "",
          },
        ],
      },
      sessionId: "sess123",
    });
    await loadIndex();
    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_completed",
      expect.objectContaining({
        verdict: "comment",
        issuesCount: 3,
        highIssues: 1,
        warningIssues: 1,
        infoIssues: 1,
        sessionId: "sess123",
      })
    );
  });

  it("emits review_failed log on error", async () => {
    mockGithubHelper.fetchDiff.mockRejectedValue(new Error("Network error"));
    await loadIndex();
    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_failed",
      expect.objectContaining({
        reason: "Network error",
        stage: "review_execution",
      })
    );
  });

  it("emits jules_api_called log with success", async () => {
    await loadIndex();
    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "jules_api_called",
      expect.objectContaining({
        success: true,
        duration: expect.any(Number),
      })
    );
  });

  it("emits review_submitted log after submitReview resolves", async () => {
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "approve",
        summary: "Good",
        newComments: [
          {
            file: "a.ts",
            line: 1,
            severity: "Info",
            confidence: "High",
            message: "Note",
            promptForAgents: "",
          },
        ],
      },
      sessionId: "sess-submit",
    });

    await loadIndex();

    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_submitted",
      expect.objectContaining({
        verdict: "approve",
        sessionId: "sess-submit",
        commentCount: 1,
      })
    );
  });

  it("sets outputs on successful review", async () => {
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "approve",
        summary: "Good",
        newComments: [
          {
            file: "a.ts",
            line: 1,
            severity: "High",
            confidence: "High",
            message: "Issue",
            promptForAgents: "",
          },
          {
            file: "b.ts",
            line: 2,
            severity: "Warning",
            confidence: "Medium",
            message: "Warning",
            promptForAgents: "",
          },
        ],
      },
      sessionId: "sess456",
    });
    await loadIndex();
    expect(mockLoggingHelper.setReviewOutputs).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: "approve",
        issues_count: 2,
        high_issues_count: 1,
        warning_issues_count: 1,
        info_issues_count: 0,
        session_id: "sess456",
      })
    );
  });

  it("sets skipped outputs on draft skip", async () => {
    (github as any).context.payload.pull_request.draft = true;
    mockGetBooleanInput.mockImplementation(
      (name: string) => name === "skip_drafts"
    );
    await loadIndex();
    expect(mockLoggingHelper.setReviewOutputs).toHaveBeenCalledWith({
      verdict: "skipped",
      issues_count: 0,
      high_issues_count: 0,
      warning_issues_count: 0,
      info_issues_count: 0,
    });
  });

  it("sets skipped outputs on fork skip", async () => {
    (github as any).context.payload.pull_request.head.repo.full_name =
      "fork/repo";
    mockGetBooleanInput.mockImplementation(
      (name: string) => name === "skip_forks"
    );
    await loadIndex();
    expect(mockLoggingHelper.setReviewOutputs).toHaveBeenCalledWith({
      verdict: "skipped",
      issues_count: 0,
      high_issues_count: 0,
      warning_issues_count: 0,
      info_issues_count: 0,
    });
  });

  it("sets skipped outputs on bypass label skip", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "jules_api_key") return "k";
      if (name === "github_token") return "t";
      if (name === "fail_on") return "any";
      if (name === "bypass_label") return "skip-review";
      return "";
    });
    (github as any).context.payload.pull_request.labels = [
      { name: "skip-review" },
    ];
    await loadIndex();
    expect(mockLoggingHelper.setReviewOutputs).toHaveBeenCalledWith({
      verdict: "skipped",
      issues_count: 0,
      high_issues_count: 0,
      warning_issues_count: 0,
      info_issues_count: 0,
    });
  });

  it("sets skipped outputs on error", async () => {
    mockGithubHelper.fetchDiff.mockRejectedValue(new Error("Fetch failed"));
    await loadIndex();
    expect(mockLoggingHelper.setReviewOutputs).toHaveBeenCalledWith({
      verdict: "skipped",
      issues_count: 0,
      high_issues_count: 0,
      warning_issues_count: 0,
      info_issues_count: 0,
    });
  });
});

describe("statusFromVerdict", () => {
  let statusFromVerdict: any;

  beforeEach(async () => {
    const mod = await import("../src/index.js");
    statusFromVerdict = mod.statusFromVerdict;
  });

  it("returns failure state with Invalid review verdict when verdict is invalid", () => {
    const result = statusFromVerdict("invalid-verdict", "blocking");
    expect(result).toEqual({
      state: "failure",
      description: "Invalid review verdict",
    });
  });

  it("handles valid verdicts normally", () => {
    const result = statusFromVerdict("approve", "blocking");
    expect(result.state).toBe("success");
    expect(result.description).toContain("complete (verdict: approve)");
  });
});

describe("truncate", () => {
  let truncate: any;

  beforeEach(async () => {
    const mod = await import("../src/index.js");
    truncate = mod.truncate;
  });

  it("returns original string if length is exactly max", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("returns original string if length is less than max", () => {
    expect(truncate("hi", 5)).toBe("hi");
  });

  it("truncates string and appends ellipsis if length exceeds max", () => {
    expect(truncate("hello world", 5)).toBe("hell…");
  });

  it("handles empty string", () => {
    expect(truncate("", 5)).toBe("");
  });

  it("handles max of 1", () => {
    expect(truncate("a", 1)).toBe("a");
    expect(truncate("ab", 1)).toBe("…");
  });
});

describe("truncate", () => {
  let truncate: any;

  beforeEach(async () => {
    const mod = await import("../src/index.js");
    truncate = mod.truncate;
  });

  it("returns original string if length is exactly max", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("returns original string if length is less than max", () => {
    expect(truncate("hi", 5)).toBe("hi");
  });

  it("truncates string and appends ellipsis if length exceeds max", () => {
    expect(truncate("hello world", 5)).toBe("hell…");
  });

  it("handles empty string", () => {
    expect(truncate("", 5)).toBe("");
  });

  it("handles max of 1", () => {
    expect(truncate("a", 1)).toBe("a");
    expect(truncate("ab", 1)).toBe("…");
  });
});
