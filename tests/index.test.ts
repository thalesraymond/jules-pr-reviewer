/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { QuotaExceededError, AuthError } from "../src/errors.js";
import { buildAnnotations } from "../src/submission.js";

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
  let mockWarning: any;
  let mockOctokit: any;

  const makeDiffSection = (path: string, contentChars: number): string => {
    const header = `diff --git a/${path} b/${path}\nindex 123..456 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n+`;
    return header + "x".repeat(contentChars) + "\n";
  };
  const BIG = makeDiffSection("src/big.ts", 60_000);
  const MID = makeDiffSection("src/mid.ts", 30_000);
  const SMALL = makeDiffSection("src/small.ts", 10_000);

  // mock sub-modules
  const mockGithubHelper = {
    fetchDiff: vi.fn(),
    loadRulesFromBase: vi.fn(),
    fetchOpenThreads: vi.fn(),
    resolveThreads: vi.fn(),
    createCheckRun: vi.fn(),
    finalizeCheckRun: vi.fn(),
  };

  const mockSubmissionHelper = {
    submitReview: vi.fn(),
    buildAnnotations,
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

  const mockConfigHelper = {
    loadConfig: vi.fn(),
  };

  const mockPathRulesHelper = {
    loadPerPathRules: vi.fn(),
  };

  const defaultConfig = {
    apiKey: "dummy_key",
    token: "dummy_token",
    failOn: "any",
    strictness: "chill",
    diffMode: "prompt",
    skipDrafts: false,
    skipForks: false,
    bypassLabel: "",
    statusContext: "",
    extraInstructions: undefined,
    rulesFilePath: undefined,
    ignoredPaths: undefined,
    timeoutMinutes: 30,
    enableSuggestions: false,
    enableApprove: false,
    dedupe: true,
    largePrThreshold: 80000,
    largePrStrategy: "prioritize",
    ignoreTitleKeywords: undefined,
    ignoreAuthors: undefined,
    reviewLabels: undefined,
    minSeverityToReport: "Info",
    blockOn: undefined,
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    mockGetInput = vi.spyOn(core, "getInput");
    mockGetBooleanInput = vi.spyOn(core, "getBooleanInput");
    mockSetFailed = vi.spyOn(core, "setFailed");
    mockSetSecret = vi.spyOn(core, "setSecret");
    mockInfo = vi.spyOn(core, "info");
    mockWarning = vi.spyOn(core, "warning");

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
    vi.doMock("../src/config.js", () => mockConfigHelper);
    vi.doMock("../src/pathRules.js", () => mockPathRulesHelper);

    // default config result
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: defaultConfig,
    });
    mockPathRulesHelper.loadPerPathRules.mockResolvedValue([]);

    // default helper returns
    mockGithubHelper.fetchDiff.mockResolvedValue("diff");
    mockGithubHelper.fetchOpenThreads.mockResolvedValue([]);
    mockGithubHelper.createCheckRun.mockResolvedValue(42);
    mockGithubHelper.finalizeCheckRun.mockResolvedValue(undefined);
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

  afterEach(() => {
    delete process.env.JULES_API_KEY;
    delete process.env.GITHUB_TOKEN;
  });

  const loadIndex = async () => {
    await import("../src/index.js");
    // Allow promises to flush
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("explicitly masks secrets in the entrypoint before loading config", async () => {
    vi.doUnmock("../src/config.js");
    await loadIndex();

    expect(mockGetInput).toHaveBeenCalledWith("jules_api_key");
    expect(mockGetInput).toHaveBeenCalledWith("github_token");

    expect(mockSetSecret).toHaveBeenCalledWith("dummy_key");
    expect(mockSetSecret).toHaveBeenCalledWith("dummy_token");
  });

  it("loads config through the real loadConfig against @actions/core", async () => {
    vi.doUnmock("../src/config.js");
    await loadIndex();
    expect(mockSetSecret).toHaveBeenCalledWith("dummy_key");
    expect(mockSetSecret).toHaveBeenCalledWith("dummy_token");
    expect(mockJulesHelper.runJulesReview).toHaveBeenCalled();
  });

  it("fails if eventName is pull_request_target", async () => {
    (github as any).context.eventName = "pull_request_target";
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("pull_request_target is not supported")
    );
    expect(mockGithubHelper.createCheckRun).not.toHaveBeenCalled();
  });

  it("fails if eventName is not pull_request", async () => {
    (github as any).context.eventName = "push";
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Unsupported event")
    );
    expect(mockGithubHelper.createCheckRun).not.toHaveBeenCalled();
  });

  it("fails if no pull_request payload", async () => {
    (github as any).context.payload.pull_request = undefined;
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith(
      "No pull_request payload found."
    );
  });

  it("fails and returns early when config is invalid", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: false,
      error: 'Invalid fail_on: "invalid"',
    });
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith('Invalid fail_on: "invalid"');
    expect(mockJulesHelper.runJulesReview).not.toHaveBeenCalled();
    expect(mockGithubHelper.fetchDiff).not.toHaveBeenCalled();
    expect(mockGithubHelper.createCheckRun).not.toHaveBeenCalled();
    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_failed",
      expect.objectContaining({
        stage: "config",
        kind: "config",
        reason: 'Invalid fail_on: "invalid"',
      })
    );
  });

  it("skips draft PR if skip_drafts is true", async () => {
    (github as any).context.payload.pull_request.draft = true;
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, skipDrafts: true },
    });
    await loadIndex();
    expect(mockInfo).toHaveBeenCalledWith("Skipping draft PR.");
  });

  it("skips fork PR if skip_forks is true", async () => {
    (github as any).context.payload.pull_request.head.repo.full_name =
      "fork/repo";
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, skipForks: true },
    });
    await loadIndex();
    expect(mockInfo).toHaveBeenCalledWith(
      "Skipping fork PR (skip_forks=true)."
    );
  });

  it("skips if bypass label is present", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, bypassLabel: "skip-review" },
    });
    (github as any).context.payload.pull_request.labels = [
      { name: "skip-review" },
    ];
    await loadIndex();
    expect(mockInfo).toHaveBeenCalledWith(
      'Bypass label "skip-review" present — skipping review.'
    );
  });

  it("skips when the PR title matches an ignore_title_keywords entry", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, ignoreTitleKeywords: "wip, do not review" },
    });
    (github as any).context.payload.pull_request.title = "WIP: feature draft";
    await loadIndex();
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("ignore_title_keywords")
    );
    expect(mockGithubHelper.createCheckRun).not.toHaveBeenCalled();
    expect(mockLoggingHelper.setReviewOutputs).toHaveBeenCalledWith({
      verdict: "skipped",
      issues_count: 0,
      high_issues_count: 0,
      warning_issues_count: 0,
      info_issues_count: 0,
    });
  });

  it("reviews when the PR title does not match ignore_title_keywords", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, ignoreTitleKeywords: "wip" },
    });
    (github as any).context.payload.pull_request.title = "Add login flow";
    await loadIndex();
    expect(mockGithubHelper.createCheckRun).toHaveBeenCalled();
    expect(mockJulesHelper.runJulesReview).toHaveBeenCalledTimes(1);
  });

  it("skips when the PR author is in ignore_authors", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, ignoreAuthors: "octocat, bot[bot]" },
    });
    (github as any).context.payload.pull_request.user = {
      login: "OctoCat",
    };
    await loadIndex();
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("ignore_authors")
    );
    expect(mockGithubHelper.createCheckRun).not.toHaveBeenCalled();
  });

  it("reviews when the PR author is not in ignore_authors", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, ignoreAuthors: "bot[bot]" },
    });
    (github as any).context.payload.pull_request.user = {
      login: "octocat",
    };
    await loadIndex();
    expect(mockGithubHelper.createCheckRun).toHaveBeenCalled();
    expect(mockJulesHelper.runJulesReview).toHaveBeenCalledTimes(1);
  });

  it("skips when a deny review_label is present", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, reviewLabels: '["-wip"]' },
    });
    (github as any).context.payload.pull_request.labels = [{ name: "WIP" }];
    await loadIndex();
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("which is denied by review_labels")
    );
    expect(mockGithubHelper.createCheckRun).not.toHaveBeenCalled();
  });

  it("skips when the PR has none of the allowed review_labels", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, reviewLabels: '["security"]' },
    });
    (github as any).context.payload.pull_request.labels = [{ name: "docs" }];
    await loadIndex();
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("none of the allowed review_labels")
    );
    expect(mockGithubHelper.createCheckRun).not.toHaveBeenCalled();
  });

  it("reviews when the PR has an allowed review_label and no deny labels", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, reviewLabels: '["security", "-wip"]' },
    });
    (github as any).context.payload.pull_request.labels = [
      { name: "security" },
    ];
    await loadIndex();
    expect(mockGithubHelper.createCheckRun).toHaveBeenCalled();
    expect(mockJulesHelper.runJulesReview).toHaveBeenCalledTimes(1);
  });

  it("reviews when only deny review_labels are configured and none are present", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, reviewLabels: '["-wip"]' },
    });
    (github as any).context.payload.pull_request.labels = [];
    await loadIndex();
    expect(mockGithubHelper.createCheckRun).toHaveBeenCalled();
    expect(mockJulesHelper.runJulesReview).toHaveBeenCalledTimes(1);
  });

  it("warns and continues when review_labels cannot be evaluated (labels missing from payload)", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, reviewLabels: '["security"]' },
    });
    (github as any).context.payload.pull_request.labels = undefined;
    await loadIndex();
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining("review_labels cannot be evaluated")
    );
    expect(mockGithubHelper.createCheckRun).toHaveBeenCalled();
    expect(mockJulesHelper.runJulesReview).toHaveBeenCalledTimes(1);
    expect(mockLoggingHelper.setReviewOutputs).not.toHaveBeenCalledWith({
      verdict: "skipped",
      issues_count: 0,
      high_issues_count: 0,
      warning_issues_count: 0,
      info_issues_count: 0,
    });
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
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, rulesFilePath: "rules.md" },
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

  it("loads per-path rules from the base SHA when rules_directory is set and merges them into the prompt", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, rulesDirectory: ".github/jules-rules" },
    });
    mockPathRulesHelper.loadPerPathRules.mockResolvedValue([
      {
        path: ".github/jules-rules/src/**.md",
        glob: "src/**",
        content: "Strict auth rules",
      },
    ]);
    mockGithubHelper.fetchDiff.mockResolvedValue(
      "diff --git a/src/auth/login.ts b/src/auth/login.ts\nindex 123..456 100644\n--- a/src/auth/login.ts\n+++ b/src/auth/login.ts\n@@ -1 +1 @@\n+new"
    );
    await loadIndex();

    expect(mockPathRulesHelper.loadPerPathRules).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      ".github/jules-rules",
      "baseSHA",
      ["src/auth/login.ts"]
    );
    const prompt = mockJulesHelper.runJulesReview.mock.calls[0][1];
    expect(prompt).toContain("# UNTRUSTED: Project-specific rules");
    expect(prompt).toContain(
      "## Per-path rules — files matching `src/**`\nStrict auth rules"
    );
  });

  it("skips per-path rule loading when rules_directory is disabled", async () => {
    await loadIndex();
    expect(mockPathRulesHelper.loadPerPathRules).not.toHaveBeenCalled();
  });

  it("merges per-path rules into the agentic prompt when rules_directory is set", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: {
        ...defaultConfig,
        diffMode: "agentic",
        rulesDirectory: ".github/jules-rules",
      },
    });
    mockPathRulesHelper.loadPerPathRules.mockResolvedValue([
      {
        path: ".github/jules-rules/src/**.md",
        glob: "src/**",
        content: "Strict auth rules",
      },
    ]);
    mockJulesHelper.runAgenticReview.mockResolvedValue({
      reviewResult: {
        verdict: "approve",
        summary: "ok",
        newComments: [],
      },
      sessionId: "agentic-session",
      fallback: false,
    });
    await loadIndex();

    const prompt = mockJulesHelper.runAgenticReview.mock.calls[0][1];
    expect(prompt).toContain(
      "## Per-path rules — files matching `src/**`\nStrict auth rules"
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

  it("instructs coverage even on a large headerless diff", async () => {
    mockGithubHelper.fetchDiff.mockResolvedValue("x".repeat(81_000));
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: { verdict: "approve", summary: "Good", newComments: [] },
      sessionId: "s1",
    });
    await loadIndex();

    const prompt = mockJulesHelper.runJulesReview.mock.calls[0][1];
    expect(prompt).toContain("# Large PR — coverage");
    expect(prompt).toContain("per-file coverage could not be computed");
  });

  it("selects a prioritized subset of a large diff and reports coverage in the posted body", async () => {
    mockGithubHelper.fetchDiff.mockResolvedValue(BIG + MID + SMALL);
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: { verdict: "approve", summary: "Good", newComments: [] },
      sessionId: "s1",
    });
    await loadIndex();

    const prompt = mockJulesHelper.runJulesReview.mock.calls[0][1];
    expect(prompt).toContain("# Large PR — coverage");
    expect(prompt).toContain("a/src/big.ts");
    expect(prompt).toContain("a/src/small.ts");
    expect(prompt).not.toContain("a/src/mid.ts");
    expect(prompt).toContain(
      "these changed files are not included in the diff below:\nsrc/mid.ts"
    );

    const body = mockSubmissionHelper.submitReview.mock.calls[0][5];
    expect(body).toContain("reviewed 2 of 3 changed files");
    expect(body).toContain("Files not covered: `src/mid.ts`");
  });

  it("does not append a coverage note for a small PR", async () => {
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: { verdict: "approve", summary: "Good", newComments: [] },
      sessionId: "s1",
    });
    await loadIndex();

    const body = mockSubmissionHelper.submitReview.mock.calls[0][5];
    expect(body).not.toContain("Large PR");
    expect(body).not.toContain("reviewed ");
  });

  it("passes large-PR coverage to the agentic prompt on a large PR", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, diffMode: "agentic", largePrThreshold: 10 },
    });
    mockGithubHelper.fetchDiff.mockResolvedValue(BIG + MID);
    mockJulesHelper.runAgenticReview.mockResolvedValue({
      reviewResult: {
        verdict: "approve",
        summary: "ok",
        newComments: [],
        changedFiles: ["src/big.ts", "src/mid.ts"],
      },
      sessionId: "agentic-session",
      fallback: false,
    });
    await loadIndex();

    const prompt = mockJulesHelper.runAgenticReview.mock.calls[0][1];
    expect(prompt).toContain("# Large PR — coverage");
    expect(prompt).toContain(
      'Your summary MUST state coverage as "Reviewed X of 2 changed files"'
    );
  });

  it("omits large-PR coverage from the agentic prompt when the PR is small", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, diffMode: "agentic" },
    });
    mockGithubHelper.fetchDiff
      .mockResolvedValue(`diff --git a/src/index.ts b/src/index.ts
index 123..456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1 @@
-old
+new`);
    mockJulesHelper.runAgenticReview.mockResolvedValue({
      reviewResult: {
        verdict: "approve",
        summary: "ok",
        newComments: [],
        changedFiles: ["src/index.ts"],
      },
      sessionId: "s1",
      fallback: false,
    });
    await loadIndex();

    const prompt = mockJulesHelper.runAgenticReview.mock.calls[0][1];
    expect(prompt).not.toContain("# Large PR — coverage");
  });

  it("emits coverage in the review_completed log on a large PR", async () => {
    mockGithubHelper.fetchDiff.mockResolvedValue(BIG + MID + SMALL);
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: { verdict: "approve", summary: "Good", newComments: [] },
      sessionId: "s1",
    });
    await loadIndex();

    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_completed",
      expect.objectContaining({
        coverage: {
          reviewedFiles: 2,
          totalFiles: 3,
          excludedCount: 1,
        },
      })
    );
  });

  it("filters diff using ignored_paths before passing to Jules", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, ignoredPaths: '["dist/**"]' },
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
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: false,
      error: 'Invalid diff_mode: "bogus"',
    });
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid diff_mode: "bogus"')
    );
    expect(mockJulesHelper.runJulesReview).not.toHaveBeenCalled();
    expect(mockJulesHelper.runAgenticReview).not.toHaveBeenCalled();
  });

  it("runs the prompt pipeline when diff_mode is prompt", async () => {
    await loadIndex();
    expect(mockJulesHelper.runJulesReview).toHaveBeenCalledTimes(1);
    expect(mockJulesHelper.runAgenticReview).not.toHaveBeenCalled();
  });

  it("runs the agentic pipeline when diff_mode is agentic", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, diffMode: "agentic" },
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
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, diffMode: "agentic" },
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
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, diffMode: "agentic" },
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
      expect.anything(),
      "COMMENT"
    );
  });

  it("handles Jules failure to return review", async () => {
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: null,
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "failure",
      {
        title: "Jules Review",
        summary:
          "Jules did not return a valid review within 30 minutes. Try increasing timeout_minutes or re-run the workflow.",
      }
    );
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Jules returned no review message")
    );
    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_failed",
      expect.objectContaining({
        stage: "timeout",
        kind: "timeout",
      })
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

  it("includes the dedupe instruction in the prompt when dedupe is enabled and open threads exist", async () => {
    mockGithubHelper.fetchOpenThreads.mockResolvedValue([
      { index: 1, threadId: "t1", path: "a.ts", line: 10, body: "Fix me" },
    ]);
    await loadIndex();
    expect(mockJulesHelper.runJulesReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("MUST NOT re-report"),
      expect.anything(),
      expect.anything()
    );
  });

  it("omits the dedupe instruction from the prompt when dedupe is disabled", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, dedupe: false },
    });
    mockGithubHelper.fetchOpenThreads.mockResolvedValue([
      { index: 1, threadId: "t1", path: "a.ts", line: 10, body: "Fix me" },
    ]);
    await loadIndex();
    const prompt = mockJulesHelper.runJulesReview.mock.calls[0][1];
    expect(prompt).toContain("# Trusted: Open Review Comments");
    expect(prompt).not.toContain("MUST NOT re-report");
  });

  it("forwards dedupe into the agentic prompt builder when open threads exist", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, diffMode: "agentic" },
    });
    mockGithubHelper.fetchOpenThreads.mockResolvedValue([
      { index: 1, threadId: "t1", path: "a.ts", line: 10, body: "Fix me" },
    ]);
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
    expect(mockJulesHelper.runAgenticReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("MUST NOT re-report"),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it("passes APPROVE to submitReview when enable_approve is true and verdict is approve", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, enableApprove: true },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: { verdict: "approve", summary: "ok", newComments: [] },
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
      expect.anything(),
      "APPROVE"
    );
  });

  it("passes COMMENT to submitReview when enable_approve is true but verdict is comment", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, enableApprove: true },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "comment",
        summary: "ok",
        newComments: [
          {
            file: "a.ts",
            line: 1,
            severity: "Warning",
            confidence: "High",
            message: "Issue",
            promptForAgents: "",
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
      expect.anything(),
      "COMMENT"
    );
  });

  it("passes COMMENT to submitReview when enable_approve is true but verdict is block", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, enableApprove: true },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "block",
        summary: "bad",
        newComments: [
          {
            file: "a.ts",
            line: 1,
            severity: "High",
            confidence: "High",
            message: "Issue",
            promptForAgents: "",
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
      expect.anything(),
      "COMMENT"
    );
  });

  it("passes COMMENT to submitReview when enable_approve is false even if verdict is approve", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, enableApprove: false },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: { verdict: "approve", summary: "ok", newComments: [] },
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
      expect.anything(),
      "COMMENT"
    );
  });

  it("submits review and sets check run conclusion based on verdict", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, failOn: "blocking" },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: { verdict: "block", summary: "bad", newComments: [] },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockSubmissionHelper.submitReview).toHaveBeenCalled();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "failure",
      expect.objectContaining({
        title: "Jules Review",
        summary: "Blocking issues found",
      })
    );
  });

  it("handles fail_on = never", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, failOn: "never" },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: { verdict: "block", summary: "bad", newComments: [] },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "success",
      expect.objectContaining({
        title: "Jules Review",
        summary: "Review complete (verdict: block)",
      })
    );
  });

  it("handles fail_on = any with approve verdict", async () => {
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: { verdict: "approve", summary: "ok", newComments: [] },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "success",
      expect.objectContaining({
        title: "Jules Review",
        summary: "Approved",
      })
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
      ]),
      "COMMENT"
    );
    const submittedComments =
      mockSubmissionHelper.submitReview.mock.calls[0][6];
    expect(submittedComments[0]).not.toHaveProperty("suggestion");
    expect(submittedComments[0]).not.toHaveProperty("startLine");
  });

  it("forwards suggestion fields when enable_suggestions is true", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, enableSuggestions: true },
    });
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

  it("fails immediately when initial createCheckRun throws permission error", async () => {
    mockGithubHelper.createCheckRun.mockRejectedValueOnce(
      new Error("Initial createCheckRun failed")
    );
    mockJulesHelper.wrapPermissionError.mockReturnValueOnce(
      new Error("Wrapped initial createCheckRun failed")
    );
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith(
      "Jules PR review failed: Wrapped initial createCheckRun failed"
    );
  });

  it("top-level catch works when loadConfig throws synchronously", async () => {
    // If loadConfig throws, run() rejects before any async work
    mockConfigHelper.loadConfig.mockImplementation(() => {
      throw new Error("Sync error");
    });
    await loadIndex();
    expect(mockSetFailed).toHaveBeenCalledWith("Sync error");
  });

  it("top-level catch handles non-Error objects thrown from loadConfig", async () => {
    mockConfigHelper.loadConfig.mockImplementation(() => {
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
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "failure",
      {
        title: "Jules Review",
        summary:
          "Review failed: Fetch diff failed. Check GitHub Actions log for details.",
      }
    );
  });

  it("finalizes the check run with an actionable quota summary on quota exhaustion", async () => {
    mockJulesHelper.runJulesReview.mockRejectedValue(
      new QuotaExceededError(
        "Jules API quota or rate limit exceeded (status code 429). The free tier allows 15 sessions per 24 hours — wait for the window to reset or reduce usage."
      )
    );
    await loadIndex();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "failure",
      {
        title: "Jules Review",
        summary: expect.stringContaining("15 sessions per 24 hours"),
      }
    );
    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_failed",
      expect.objectContaining({
        stage: "quota",
        kind: "quota",
      })
    );
    expect(mockSetFailed).toHaveBeenCalledWith(
      "Jules PR review failed: Jules API quota or rate limit exceeded (status code 429). The free tier allows 15 sessions per 24 hours — wait for the window to reset or reduce usage."
    );
  });

  it("classifies a raw 429 as quota and finalizes the check run", async () => {
    mockJulesHelper.runJulesReview.mockRejectedValue(
      new Error("status code 429")
    );
    await loadIndex();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "failure",
      {
        title: "Jules Review",
        summary: expect.stringContaining("15 sessions per 24 hours"),
      }
    );
  });

  it("finalizes the check run with an auth failure surface on auth errors", async () => {
    mockJulesHelper.runJulesReview.mockRejectedValue(
      new AuthError(
        "Jules API rejected request (status code 401). Check JULES_API_KEY is valid."
      )
    );
    await loadIndex();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "failure",
      {
        title: "Jules Review",
        summary: expect.stringContaining("Check JULES_API_KEY is valid"),
      }
    );
    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_failed",
      expect.objectContaining({
        stage: "auth",
        kind: "auth",
      })
    );
  });

  it("regression: never leaves a stale in_progress check run when a mid-run failure occurs", async () => {
    mockGithubHelper.fetchDiff.mockRejectedValue(new Error("boom mid-run"));
    await loadIndex();
    expect(mockGithubHelper.createCheckRun).toHaveBeenCalledTimes(1);
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "failure",
      expect.anything()
    );
  });

  it("fails the check run on a parse-failure review even when fail_on is never", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, failOn: "never" },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        summary: "Jules returned an invalid response that could not be parsed.",
        verdict: "block",
        resolvedCommentIds: [],
        newComments: [],
        unparseable: true,
      },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "failure",
      expect.objectContaining({
        summary: expect.stringContaining("could not be parsed"),
      })
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
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, skipDrafts: true },
    });
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
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, skipForks: true },
    });
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
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, bypassLabel: "skip-review" },
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

  it("drops findings below min_severity_to_report from posting, annotations, counts, and logs", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, minSeverityToReport: "Warning" },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "comment",
        summary: "ok",
        newComments: [
          {
            file: "a.ts",
            line: 1,
            severity: "High",
            confidence: "High",
            message: "High issue",
            promptForAgents: "",
          },
          {
            file: "b.ts",
            line: 2,
            severity: "Warning",
            confidence: "Medium",
            message: "Warning issue",
            promptForAgents: "",
          },
          {
            file: "c.ts",
            line: 3,
            severity: "Info",
            confidence: "Low",
            message: "Info note",
            promptForAgents: "",
          },
        ],
      },
      sessionId: "s1",
    });
    await loadIndex();

    const submittedComments =
      mockSubmissionHelper.submitReview.mock.calls[0][6];
    expect(submittedComments.map((c: any) => c.file)).toEqual(["a.ts", "b.ts"]);

    const annotationCall = mockGithubHelper.finalizeCheckRun.mock.calls.find(
      (c: any) => c[5]?.annotations
    );
    expect(annotationCall).toBeDefined();
    expect(annotationCall[5].annotations.map((a: any) => a.path)).toEqual([
      "a.ts",
      "b.ts",
    ]);

    expect(mockLoggingHelper.setReviewOutputs).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: "comment",
        issues_count: 2,
        high_issues_count: 1,
        warning_issues_count: 1,
        info_issues_count: 0,
      })
    );
    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_completed",
      expect.objectContaining({
        issuesCount: 2,
        highIssues: 1,
        warningIssues: 1,
        infoIssues: 0,
      })
    );
    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_submitted",
      expect.objectContaining({ commentCount: 2 })
    );
  });

  it("keeps all findings when min_severity_to_report is unset (default Info)", async () => {
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "comment",
        summary: "ok",
        newComments: [
          {
            file: "a.ts",
            line: 1,
            severity: "High",
            confidence: "High",
            message: "High issue",
            promptForAgents: "",
          },
          {
            file: "c.ts",
            line: 3,
            severity: "Info",
            confidence: "Low",
            message: "Info note",
            promptForAgents: "",
          },
        ],
      },
      sessionId: "s1",
    });
    await loadIndex();
    const submittedComments =
      mockSubmissionHelper.submitReview.mock.calls[0][6];
    expect(submittedComments).toHaveLength(2);
    expect(mockLoggingHelper.setReviewOutputs).toHaveBeenCalledWith(
      expect.objectContaining({
        issues_count: 2,
        info_issues_count: 1,
      })
    );
  });

  it("fails the check run when block_on is set and a finding reaches the severity", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, blockOn: "High", failOn: "never" },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "block",
        summary: "bad",
        newComments: [
          {
            file: "a.ts",
            line: 1,
            severity: "High",
            confidence: "High",
            message: "High issue",
            promptForAgents: "",
          },
        ],
      },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "failure",
      expect.objectContaining({
        summary: expect.stringContaining("high severity"),
      })
    );
  });

  it("does not fail the check run when block_on is set but no finding reaches the severity", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, blockOn: "High", failOn: "any" },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "comment",
        summary: "warnings only",
        newComments: [
          {
            file: "b.ts",
            line: 2,
            severity: "Warning",
            confidence: "Medium",
            message: "Warning issue",
            promptForAgents: "",
          },
        ],
      },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "success",
      expect.objectContaining({
        summary: expect.stringContaining("No findings at or above high"),
      })
    );
  });

  it("uses fail_on when block_on is unset even for a comment verdict with fail_on any", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, failOn: "any" },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "comment",
        summary: "found things",
        newComments: [],
      },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "failure",
      expect.objectContaining({ summary: "Review verdict: comment" })
    );
  });

  it("forwards strictness into the prompt-mode prompt builder", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, strictness: "assertive" },
    });
    await loadIndex();
    const prompt = mockJulesHelper.runJulesReview.mock.calls[0][1];
    expect(prompt).toContain("# Trusted: Strictness profile (assertive)");
  });

  it("forwards strictness into the agentic prompt builder", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, diffMode: "agentic", strictness: "quiet" },
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
    const prompt = mockJulesHelper.runAgenticReview.mock.calls[0][1];
    expect(prompt).toContain("# Trusted: Strictness profile (quiet)");
  });

  it("suppresses Warning and Info findings in quiet mode end to end", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, strictness: "quiet" },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "comment",
        summary: "Mixed findings",
        newComments: [
          {
            file: "a.ts",
            line: 1,
            severity: "High",
            confidence: "High",
            message: "Bug",
            promptForAgents: "",
          },
          {
            file: "b.ts",
            line: 2,
            severity: "Warning",
            confidence: "Medium",
            message: "Meh",
            promptForAgents: "",
          },
          {
            file: "c.ts",
            line: 3,
            severity: "Info",
            confidence: "Low",
            message: "Nit",
            promptForAgents: "",
          },
        ],
      },
      sessionId: "s1",
    });
    await loadIndex();

    const submittedComments =
      mockSubmissionHelper.submitReview.mock.calls[0][6];
    expect(submittedComments).toHaveLength(1);
    expect(submittedComments[0]).toMatchObject({
      file: "a.ts",
      severity: "High",
    });

    const checkRunOptions = mockGithubHelper.finalizeCheckRun.mock.calls[0][5];
    expect(checkRunOptions.annotations).toHaveLength(1);
    expect(checkRunOptions.annotations[0]).toMatchObject({
      path: "a.ts",
      annotationLevel: "failure",
    });

    expect(mockLoggingHelper.setReviewOutputs).toHaveBeenCalledWith(
      expect.objectContaining({
        issues_count: 1,
        high_issues_count: 1,
        warning_issues_count: 0,
        info_issues_count: 0,
      })
    );

    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_submitted",
      expect.objectContaining({ commentCount: 1 })
    );
    expect(mockLoggingHelper.logStructured).toHaveBeenCalledWith(
      "review_completed",
      expect.objectContaining({
        issuesCount: 1,
        highIssues: 1,
        warningIssues: 0,
        infoIssues: 0,
      })
    );
  });

  it("keeps the LLM verdict unchanged in quiet mode even when findings are suppressed", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, strictness: "quiet", failOn: "any" },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "comment",
        summary: "Only warnings",
        newComments: [
          {
            file: "b.ts",
            line: 2,
            severity: "Warning",
            confidence: "Medium",
            message: "Meh",
            promptForAgents: "",
          },
        ],
      },
      sessionId: "s1",
    });
    await loadIndex();

    expect(mockSubmissionHelper.submitReview.mock.calls[0][6]).toHaveLength(0);
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "failure",
      expect.objectContaining({
        summary: "Review verdict: comment",
      })
    );
  });

  it("quiet mode does not trip a block_on warning gate on suppressed findings", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, strictness: "quiet", blockOn: "Warning" },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "block",
        summary: "warnings only",
        newComments: [
          {
            file: "b.ts",
            line: 2,
            severity: "Warning",
            confidence: "Medium",
            message: "Meh",
            promptForAgents: "",
          },
        ],
      },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "success",
      expect.objectContaining({
        summary: expect.stringContaining("No findings at or above warning"),
      })
    );
  });

  it("quiet mode still trips a block_on high gate on reported High findings", async () => {
    mockConfigHelper.loadConfig.mockReturnValue({
      ok: true,
      config: { ...defaultConfig, strictness: "quiet", blockOn: "High" },
    });
    mockJulesHelper.runJulesReview.mockResolvedValue({
      reviewResult: {
        verdict: "comment",
        summary: "one high",
        newComments: [
          {
            file: "a.ts",
            line: 1,
            severity: "High",
            confidence: "High",
            message: "Bug",
            promptForAgents: "",
          },
          {
            file: "b.ts",
            line: 2,
            severity: "Warning",
            confidence: "Medium",
            message: "Meh",
            promptForAgents: "",
          },
        ],
      },
      sessionId: "s1",
    });
    await loadIndex();
    expect(mockGithubHelper.finalizeCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      42,
      "failure",
      expect.objectContaining({
        summary: expect.stringContaining("Findings at or above high"),
      })
    );
  });
});
