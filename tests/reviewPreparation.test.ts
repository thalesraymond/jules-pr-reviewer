import { describe, it, expect, vi, beforeEach } from "vitest";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import { prepareReview } from "../src/reviewPreparation.js";

vi.mock("@actions/core", () => ({ info: vi.fn() }));

const mockFetchDiff = vi.fn();
const mockLoadRulesFromBase = vi.fn();
const mockFetchOpenThreads = vi.fn();
const mockFilterDiff = vi.fn();
const mockExtractChangedFilePaths = vi.fn();
const mockLoadPerPathRules = vi.fn();

vi.mock("../src/github.js", () => ({
  fetchDiff: (...args: unknown[]) => mockFetchDiff(...args),
  loadRulesFromBase: (...args: unknown[]) => mockLoadRulesFromBase(...args),
  fetchOpenThreads: (...args: unknown[]) => mockFetchOpenThreads(...args),
}));

vi.mock("../src/filtering.js", () => ({
  parseIgnoredPaths: (input: string) => (input ? [input] : []),
  filterDiff: (...args: unknown[]) => mockFilterDiff(...args),
  extractChangedFilePaths: (...args: unknown[]) =>
    mockExtractChangedFilePaths(...args),
}));

vi.mock("../src/pathRules.js", () => ({
  loadPerPathRules: (...args: unknown[]) => mockLoadPerPathRules(...args),
}));

const baseConfig = {
  ignoredPaths: undefined as string | undefined,
  rulesFilePath: undefined as string | undefined,
  rulesDirectory: undefined as string | undefined,
};

const octokit = getOctokit("test-token");

describe("prepareReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchDiff.mockResolvedValue("raw diff");
    mockLoadRulesFromBase.mockResolvedValue(undefined);
    mockFetchOpenThreads.mockResolvedValue([]);
    mockFilterDiff.mockReturnValue("filtered diff");
    mockExtractChangedFilePaths.mockReturnValue(["src/a.ts"]);
    mockLoadPerPathRules.mockResolvedValue([]);
  });

  it.each([
    {
      action: "opened",
      before: "beforeSHA",
      diffMode: "prompt",
      expected: "baseSHA",
    },
    {
      action: "synchronize",
      before: "beforeSHA",
      diffMode: "prompt",
      expected: "beforeSHA",
    },
    {
      action: "synchronize",
      before: "baseSHA",
      diffMode: "prompt",
      expected: "baseSHA",
      incremental: true,
    },
    {
      action: "synchronize",
      before: undefined,
      diffMode: "prompt",
      expected: "baseSHA",
    },
    {
      action: "synchronize",
      before: "beforeSHA",
      diffMode: "agentic",
      expected: "baseSHA",
    },
    {
      action: "opened",
      before: "beforeSHA",
      diffMode: "agentic",
      expected: "baseSHA",
    },
  ] as const)(
    "prepares $diffMode review for $action with previous SHA $before from $expected",
    async ({ action, before, diffMode, expected, incremental }) => {
      await prepareReview(
        octokit,
        "owner",
        "repo",
        1,
        { action, before, diffMode, baseSha: "baseSHA", headSha: "headSHA" },
        { ...baseConfig, rulesFilePath: "rules.md", rulesDirectory: "rules" }
      );

      expect(mockFetchDiff).toHaveBeenCalledWith(
        octokit,
        "owner",
        "repo",
        { number: 1 },
        expected,
        "headSHA"
      );
      expect(mockLoadRulesFromBase).toHaveBeenCalledWith(
        octokit,
        "owner",
        "repo",
        "rules.md",
        "baseSHA"
      );
      expect(mockLoadPerPathRules).toHaveBeenCalledWith(
        octokit,
        "owner",
        "repo",
        "rules",
        "baseSHA",
        ["src/a.ts"]
      );
      expect(core.info).toHaveBeenCalledWith(
        expected === "beforeSHA" || incremental
          ? `Synchronize event detected. Reviewing incremental changes from ${expected} to headSHA`
          : "Reviewing full PR diff from baseSHA to headSHA"
      );
    }
  );

  it("fetches, filters, and extracts changed files", async () => {
    const result = await prepareReview(
      octokit,
      "owner",
      "repo",
      1,
      {
        action: "opened",
        diffMode: "prompt",
        baseSha: "baseSHA",
        headSha: "headSHA",
      },
      baseConfig
    );

    expect(mockFetchDiff).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      { number: 1 },
      "baseSHA",
      "headSHA"
    );
    expect(mockFilterDiff).toHaveBeenCalledWith("raw diff", []);
    expect(mockExtractChangedFilePaths).toHaveBeenCalledWith("filtered diff");
    expect(result).toEqual({
      diff: "filtered diff",
      changedFiles: ["src/a.ts"],
      rulesFromFile: undefined,
      perPathRules: [],
      openThreads: [],
    });
  });

  it("loads rules from file when rules_file is configured", async () => {
    mockLoadRulesFromBase.mockResolvedValue("project rules");
    const result = await prepareReview(
      octokit,
      "owner",
      "repo",
      1,
      {
        action: "opened",
        diffMode: "prompt",
        baseSha: "baseSHA",
        headSha: "headSHA",
      },
      { ...baseConfig, rulesFilePath: "rules.md" }
    );

    expect(mockLoadRulesFromBase).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      "rules.md",
      "baseSHA"
    );
    expect(result.rulesFromFile).toBe("project rules");
  });

  it("loads per-path rules when rules_directory is configured", async () => {
    mockLoadPerPathRules.mockResolvedValue([
      { path: "rules/src.md", glob: "src/**", content: "Be strict" },
    ]);
    const result = await prepareReview(
      octokit,
      "owner",
      "repo",
      1,
      {
        action: "opened",
        diffMode: "prompt",
        baseSha: "baseSHA",
        headSha: "headSHA",
      },
      { ...baseConfig, rulesDirectory: ".github/jules-rules" }
    );

    expect(mockLoadPerPathRules).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      ".github/jules-rules",
      "baseSHA",
      ["src/a.ts"]
    );
    expect(result.perPathRules).toEqual([
      { path: "rules/src.md", glob: "src/**", content: "Be strict" },
    ]);
  });

  it("fetches open threads", async () => {
    mockFetchOpenThreads.mockResolvedValue([
      { index: 1, threadId: "t1", path: "a.ts", line: 1, body: "old" },
    ]);
    const result = await prepareReview(
      octokit,
      "owner",
      "repo",
      1,
      {
        action: "opened",
        diffMode: "prompt",
        baseSha: "baseSHA",
        headSha: "headSHA",
      },
      baseConfig
    );

    expect(mockFetchOpenThreads).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      1
    );
    expect(result.openThreads).toEqual([
      { index: 1, threadId: "t1", path: "a.ts", line: 1, body: "old" },
    ]);
  });

  it("passes ignored paths to filterDiff", async () => {
    await prepareReview(
      octokit,
      "owner",
      "repo",
      1,
      {
        action: "opened",
        diffMode: "prompt",
        baseSha: "baseSHA",
        headSha: "headSHA",
      },
      { ...baseConfig, ignoredPaths: "*.test.ts" }
    );

    expect(mockFilterDiff).toHaveBeenCalledWith("raw diff", ["*.test.ts"]);
  });
});
