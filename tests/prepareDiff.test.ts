import { describe, it, expect, vi, beforeEach } from "vitest";
import { prepareDiff } from "../src/prepareDiff.js";

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

const octokit = { rest: {} } as unknown as ReturnType<
  typeof import("@actions/github").getOctokit
>;

describe("prepareDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchDiff.mockResolvedValue("raw diff");
    mockLoadRulesFromBase.mockResolvedValue(undefined);
    mockFetchOpenThreads.mockResolvedValue([]);
    mockFilterDiff.mockReturnValue("filtered diff");
    mockExtractChangedFilePaths.mockReturnValue(["src/a.ts"]);
    mockLoadPerPathRules.mockResolvedValue([]);
  });

  it("fetches, filters, and extracts changed files", async () => {
    const result = await prepareDiff(
      octokit,
      "owner",
      "repo",
      1,
      "diffBaseSHA",
      "rulesBaseSHA",
      "headSHA",
      baseConfig
    );

    expect(mockFetchDiff).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      { number: 1 },
      "diffBaseSHA",
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
    const result = await prepareDiff(
      octokit,
      "owner",
      "repo",
      1,
      "diffBaseSHA",
      "rulesBaseSHA",
      "headSHA",
      { ...baseConfig, rulesFilePath: "rules.md" }
    );

    expect(mockLoadRulesFromBase).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      "rules.md",
      "rulesBaseSHA"
    );
    expect(result.rulesFromFile).toBe("project rules");
  });

  it("loads per-path rules when rules_directory is configured", async () => {
    mockLoadPerPathRules.mockResolvedValue([
      { path: "rules/src.md", glob: "src/**", content: "Be strict" },
    ]);
    const result = await prepareDiff(
      octokit,
      "owner",
      "repo",
      1,
      "diffBaseSHA",
      "rulesBaseSHA",
      "headSHA",
      { ...baseConfig, rulesDirectory: ".github/jules-rules" }
    );

    expect(mockLoadPerPathRules).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      ".github/jules-rules",
      "rulesBaseSHA",
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
    const result = await prepareDiff(
      octokit,
      "owner",
      "repo",
      1,
      "diffBaseSHA",
      "rulesBaseSHA",
      "headSHA",
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
    await prepareDiff(
      octokit,
      "owner",
      "repo",
      1,
      "diffBaseSHA",
      "rulesBaseSHA",
      "headSHA",
      { ...baseConfig, ignoredPaths: "*.test.ts" }
    );

    expect(mockFilterDiff).toHaveBeenCalledWith("raw diff", ["*.test.ts"]);
  });
});
