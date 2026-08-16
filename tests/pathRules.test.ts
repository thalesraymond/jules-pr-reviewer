/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as core from "@actions/core";
import {
  isRuleFile,
  globFromRulePath,
  isWellFormedGlob,
  parseRuleCandidates,
  selectMatchingRules,
  loadPerPathRules,
  type PathRuleCandidate,
} from "../src/pathRules.js";

vi.mock("@actions/core");

const mockListFilesInDirectory = vi.fn();
const mockLoadRulesFromBase = vi.fn();

vi.mock("../src/github.js", () => ({
  listFilesInDirectory: (...args: unknown[]) =>
    mockListFilesInDirectory(...args),
  loadRulesFromBase: (...args: unknown[]) => mockLoadRulesFromBase(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isRuleFile", () => {
  it("accepts .md files", () => {
    expect(isRuleFile("src/**.md")).toBe(true);
    expect(isRuleFile("**.md")).toBe(true);
  });

  it("rejects non-md files", () => {
    expect(isRuleFile("src/**.txt")).toBe(false);
    expect(isRuleFile(".gitkeep")).toBe(false);
    expect(isRuleFile("src/**")).toBe(false);
  });
});

describe("globFromRulePath", () => {
  it("strips the trailing .md extension to derive the glob", () => {
    expect(globFromRulePath("src/**.md")).toBe("src/**");
    expect(globFromRulePath("**.md")).toBe("**");
    expect(globFromRulePath("docs/guides/**.md")).toBe("docs/guides/**");
  });

  it("strips exactly one .md extension", () => {
    expect(globFromRulePath("src/**.test.ts.md")).toBe("src/**.test.ts");
    expect(globFromRulePath("**.md.md")).toBe("**.md");
  });
});

describe("isWellFormedGlob", () => {
  it("accepts well-formed globs", () => {
    expect(isWellFormedGlob("src/**")).toBe(true);
    expect(isWellFormedGlob("**")).toBe(true);
    expect(isWellFormedGlob("[a-z]*.ts")).toBe(true);
    expect(isWellFormedGlob("{src,docs}/**")).toBe(true);
    expect(isWellFormedGlob("*")).toBe(true);
  });

  it("rejects unbalanced brackets and braces", () => {
    expect(isWellFormedGlob("[")).toBe(false);
    expect(isWellFormedGlob("]")).toBe(false);
    expect(isWellFormedGlob("src/[{]")).toBe(false);
    expect(isWellFormedGlob("}foo")).toBe(false);
  });

  it("ignores escaped brackets", () => {
    expect(isWellFormedGlob("\\[literal\\]")).toBe(true);
  });
});

describe("parseRuleCandidates", () => {
  it("filters to .md files under the rules directory and derives globs, sorted by path", () => {
    const candidates = parseRuleCandidates(
      [
        ".github/jules-rules/src/**.md",
        ".github/jules-rules/README.txt",
        ".github/jules-rules/**.md",
        ".github/jules-rules/docs/guides/**.md",
        ".github/other/**.md",
      ],
      ".github/jules-rules"
    );

    expect(candidates).toEqual([
      {
        path: ".github/jules-rules/**.md",
        glob: "**",
      },
      {
        path: ".github/jules-rules/docs/guides/**.md",
        glob: "docs/guides/**",
      },
      {
        path: ".github/jules-rules/src/**.md",
        glob: "src/**",
      },
    ]);
  });

  it("tolerates a trailing slash on the rules directory", () => {
    const candidates = parseRuleCandidates(
      [".github/jules-rules/src/**.md"],
      ".github/jules-rules/"
    );

    expect(candidates[0]?.glob).toBe("src/**");
  });

  it("returns [] for an empty or unrelated listing", () => {
    expect(parseRuleCandidates([], ".github/rules")).toEqual([]);
    expect(
      parseRuleCandidates([".github/rules.txt"], ".github/rules") // a file, not a directory
    ).toEqual([]);
    expect(parseRuleCandidates(["src/a.md"], ".github/missing")).toEqual([]);
  });
});

describe("selectMatchingRules", () => {
  const authRule: PathRuleCandidate = {
    path: ".github/rules/src/**.md",
    glob: "src/**",
  };
  const docsRule: PathRuleCandidate = {
    path: ".github/rules/docs/**.md",
    glob: "docs/**",
  };
  const allRule: PathRuleCandidate = {
    path: ".github/rules/**.md",
    glob: "**",
  };

  it("keeps rules whose glob matches at least one changed file", () => {
    const matched = selectMatchingRules(
      [authRule, docsRule],
      ["src/auth/login.ts", "README.md"]
    );

    expect(matched.map((r) => r.glob)).toEqual(["src/**"]);
  });

  it("keeps the catch-all glob when any file changes", () => {
    const matched = selectMatchingRules([allRule], ["src/auth/login.ts"]);

    expect(matched.map((r) => r.glob)).toEqual(["**"]);
  });

  it("matches a globstar-with-suffix rule against nested paths", () => {
    const testRule: PathRuleCandidate = {
      path: ".github/rules/**.test.ts.md",
      glob: "**.test.ts",
    };

    const matched = selectMatchingRules(
      [testRule],
      ["src/auth/login.test.ts", "README.md"]
    );

    expect(matched.map((r) => r.glob)).toEqual(["**.test.ts"]);
  });

  it("matches a globstar-with-suffix rule against root paths", () => {
    const testRule: PathRuleCandidate = {
      path: ".github/rules/**.test.ts.md",
      glob: "**.test.ts",
    };

    const matched = selectMatchingRules([testRule], ["login.test.ts"]);

    expect(matched.map((r) => r.glob)).toEqual(["**.test.ts"]);
  });

  it("keeps no rules when no changed file matches", () => {
    const matched = selectMatchingRules([authRule, docsRule], ["lib/util.ts"]);

    expect(matched).toEqual([]);
  });

  it("returns [] when there are no changed files", () => {
    expect(selectMatchingRules([authRule], [])).toEqual([]);
  });

  it("warns and skips malformed globs instead of throwing", () => {
    const malformed: PathRuleCandidate = {
      path: ".github/rules/[.md",
      glob: "[",
    };
    const matched = selectMatchingRules(
      [malformed, authRule],
      ["src/auth/login.ts"]
    );

    expect(matched.map((r) => r.glob)).toEqual(["src/**"]);
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('"["'));
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining(".github/rules/[.md")
    );
  });
});

describe("loadPerPathRules", () => {
  const octokit = {} as any;

  it("loads content only for rule files matching the changed files, from the base SHA", async () => {
    mockListFilesInDirectory.mockResolvedValue([
      ".github/rules/docs/**.md",
      ".github/rules/src/**.md",
      ".github/rules/src/auth/**.md",
      ".github/rules/notes.txt",
    ]);
    mockLoadRulesFromBase.mockImplementation(
      (_octokit: unknown, _owner: string, _repo: string, path: string) => {
        const contents: Record<string, string> = {
          ".github/rules/docs/**.md": "Doc style rules",
          ".github/rules/src/**.md": "Strict auth rules",
          ".github/rules/src/auth/**.md": "Extra strict login rules",
        };
        return Promise.resolve(contents[path]);
      }
    );

    const rules = await loadPerPathRules(
      octokit,
      "owner",
      "repo",
      ".github/rules",
      "baseSHA",
      ["src/auth/login.ts", "docs/guide.md"]
    );

    expect(mockListFilesInDirectory).toHaveBeenCalledWith(
      octokit,
      "owner",
      "repo",
      ".github/rules",
      "baseSHA"
    );
    expect(rules).toEqual([
      {
        path: ".github/rules/docs/**.md",
        glob: "docs/**",
        content: "Doc style rules",
      },
      {
        path: ".github/rules/src/**.md",
        glob: "src/**",
        content: "Strict auth rules",
      },
      {
        path: ".github/rules/src/auth/**.md",
        glob: "src/auth/**",
        content: "Extra strict login rules",
      },
    ]);
  });

  it("loads nothing when no rule file matches the changed files", async () => {
    mockListFilesInDirectory.mockResolvedValue([".github/rules/src/**.md"]);
    const rules = await loadPerPathRules(
      octokit,
      "owner",
      "repo",
      ".github/rules",
      "baseSHA",
      ["lib/util.ts"]
    );

    expect(rules).toEqual([]);
    expect(mockLoadRulesFromBase).not.toHaveBeenCalled();
  });

  it("returns [] when the directory listing is empty or fails", async () => {
    mockListFilesInDirectory.mockResolvedValue([]);
    const rules = await loadPerPathRules(
      octokit,
      "owner",
      "repo",
      ".github/rules",
      "baseSHA",
      ["src/auth/login.ts"]
    );

    expect(rules).toEqual([]);
    expect(mockLoadRulesFromBase).not.toHaveBeenCalled();
  });

  it("skips unreadable rule files (loadRulesFromBase undefined) without crashing", async () => {
    mockListFilesInDirectory.mockResolvedValue([
      ".github/rules/src/**.md",
      ".github/rules/docs/**.md",
    ]);
    mockLoadRulesFromBase.mockResolvedValue(undefined);

    const rules = await loadPerPathRules(
      octokit,
      "owner",
      "repo",
      ".github/rules",
      "baseSHA",
      ["src/auth/login.ts", "docs/guide.md"]
    );

    expect(rules).toEqual([]);
    expect(mockLoadRulesFromBase).toHaveBeenCalledTimes(2);
  });

  it("warns and skips a malformed glob found in the directory", async () => {
    mockListFilesInDirectory.mockResolvedValue([
      ".github/rules/[.md",
      ".github/rules/src/**.md",
    ]);
    mockLoadRulesFromBase.mockResolvedValue("Strict auth rules");

    const rules = await loadPerPathRules(
      octokit,
      "owner",
      "repo",
      ".github/rules",
      "baseSHA",
      ["src/auth/login.ts"]
    );

    expect(rules).toEqual([
      {
        path: ".github/rules/src/**.md",
        glob: "src/**",
        content: "Strict auth rules",
      },
    ]);
    expect(mockLoadRulesFromBase).toHaveBeenCalledTimes(1);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining(".github/rules/[.md")
    );
  });
});
