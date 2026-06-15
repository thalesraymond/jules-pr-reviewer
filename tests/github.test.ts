/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import {
  fetchDiff,
  loadRulesFromBase,
  resolveThreads,
  setStatus,
  submitReview,
  fetchOpenThreads,
  extractChangedFilesFromDiff,
} from "../src/github.js";

describe("github.ts", () => {
  it("fetchDiff works with compareCommitsWithBasehead", async () => {
    const octokit = {
      rest: {
        repos: {
          compareCommitsWithBasehead: vi
            .fn()
            .mockResolvedValue({ data: "diff content" }),
        },
      },
    } as any;
    const diff = await fetchDiff(
      octokit,
      "owner",
      "repo",
      { number: 1 },
      "baseSHA",
      "headSHA"
    );
    expect(diff).toBe("diff content");
  });

  it("fetchDiff falls back if compareCommitsWithBasehead returns non-string data", async () => {
    const octokit = {
      rest: {
        repos: {
          compareCommitsWithBasehead: vi
            .fn()
            .mockResolvedValue({ data: { format: "not a string" } }),
        },
        pulls: {
          get: vi
            .fn()
            .mockResolvedValue({ data: "fallback diff from pulls.get" }),
        },
      },
    } as any;
    const diff = await fetchDiff(
      octokit,
      "owner",
      "repo",
      { number: 1 },
      "baseSHA",
      "headSHA"
    );
    expect(diff).toBe("fallback diff from pulls.get");
  });

  it("fetchDiff falls back to pulls.get when compareCommitsWithBasehead fails", async () => {
    const octokit = {
      rest: {
        repos: {
          compareCommitsWithBasehead: vi
            .fn()
            .mockRejectedValue(new Error("fail")),
        },
        pulls: { get: vi.fn().mockResolvedValue({ data: "fallback diff" }) },
      },
    } as any;
    const diff = await fetchDiff(
      octokit,
      "owner",
      "repo",
      { number: 1 },
      "baseSHA",
      "headSHA"
    );
    expect(diff).toBe("fallback diff");
  });

  it("fetchDiff throws if pulls.get fails to return a string diff", async () => {
    const octokit = {
      rest: {
        repos: {
          compareCommitsWithBasehead: vi
            .fn()
            .mockRejectedValue(new Error("fail")),
        },
        pulls: { get: vi.fn().mockResolvedValue({ data: {} }) },
      },
    } as any;
    await expect(
      fetchDiff(octokit, "owner", "repo", { number: 1 }, "baseSHA", "headSHA")
    ).rejects.toThrow("GitHub returned no diff text.");
  });

  it("loadRulesFromBase works when file exists", async () => {
    const content = "rule1\nrule2";
    const base64Content = Buffer.from(content).toString("base64");
    const octokit = {
      rest: {
        repos: {
          getContent: vi
            .fn()
            .mockResolvedValue({ data: { content: base64Content } }),
        },
      },
    } as any;
    const rules = await loadRulesFromBase(
      octokit,
      "owner",
      "repo",
      "path",
      "sha"
    );
    expect(rules).toBe(content);
  });

  it("loadRulesFromBase returns undefined on error", async () => {
    const octokit = {
      rest: {
        repos: {
          getContent: vi.fn().mockRejectedValue(new Error("Not found")),
        },
      },
    } as any;
    const rules = await loadRulesFromBase(
      octokit,
      "owner",
      "repo",
      "path",
      "sha"
    );
    expect(rules).toBeUndefined();
  });

  it("loadRulesFromBase returns undefined if content is missing", async () => {
    const octokit = {
      rest: { repos: { getContent: vi.fn().mockResolvedValue({ data: {} }) } },
    } as any;
    const rules = await loadRulesFromBase(
      octokit,
      "owner",
      "repo",
      "path",
      "sha"
    );
    expect(rules).toBeUndefined();
  });

  it("fetchOpenThreads parses graphql response correctly", async () => {
    const octokit = {
      graphql: vi.fn().mockResolvedValue({
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: "t1",
                  isResolved: false,
                  comments: {
                    nodes: [
                      {
                        body: "<!-- jules-inline-comment -->\nMsg",
                        path: "a.ts",
                        line: 10,
                        author: { login: "bot" },
                      },
                    ],
                  },
                },
                {
                  id: "t2",
                  isResolved: true,
                  comments: {
                    nodes: [
                      {
                        body: "<!-- jules-inline-comment -->\nMsg",
                        path: "b.ts",
                        line: 20,
                      },
                    ],
                  },
                },
                {
                  id: "t3",
                  isResolved: false,
                  comments: {
                    nodes: [
                      { body: "Normal user comment", path: "c.ts", line: 30 },
                    ],
                  },
                },
                {
                  id: "t4",
                  isResolved: false,
                  comments: { nodes: [] }, // empty
                },
                {
                  id: "t5",
                  isResolved: false,
                  comments: {
                    nodes: [
                      {
                        body: "<!-- jules-inline-comment -->\nNo Line",
                        path: "d.ts",
                        line: null,
                        author: { login: "bot" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      }),
    } as any;

    const threads = await fetchOpenThreads(octokit, "owner", "repo", 1);
    expect(threads).toEqual([
      {
        index: 1,
        threadId: "t1",
        path: "a.ts",
        line: 10,
        body: "<!-- jules-inline-comment -->\nMsg",
      },
      {
        index: 2,
        threadId: "t5",
        path: "d.ts",
        line: 0,
        body: "<!-- jules-inline-comment -->\nNo Line",
      },
    ]);
  });

  it("fetchOpenThreads handles empty response", async () => {
    const octokit = { graphql: vi.fn().mockResolvedValue({}) } as any;
    const threads = await fetchOpenThreads(octokit, "owner", "repo", 1);
    expect(threads).toEqual([]);
  });

  it("resolveThreads resolves threads successfully", async () => {
    const octokit = { graphql: vi.fn().mockResolvedValue({}) } as any;
    await resolveThreads(octokit, ["t1", "t2"]);
    expect(octokit.graphql).toHaveBeenCalledTimes(2);
  });

  it("resolveThreads handles failures gracefully", async () => {
    const octokit = {
      graphql: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("fail")),
    } as any;
    await resolveThreads(octokit, ["t1", "t2"]);
    expect(octokit.graphql).toHaveBeenCalledTimes(2);
  });

  it("submitReview sends proper payload", async () => {
    const octokit = {
      rest: { pulls: { createReview: vi.fn().mockResolvedValue({}) } },
    } as any;
    await submitReview(octokit, "owner", "repo", 1, "headSHA", "Summary text", [
      {
        file: "a.ts",
        line: 10,
        severity: "High",
        confidence: "High",
        message: "Msg",
        promptForAgents: "Fix this issue by doing X",
      },
      {
        file: "b.ts",
        line: 20,
        severity: "Warning",
        confidence: "Medium",
        message: "Msg2",
        promptForAgents: "",
      },
      {
        file: "c.ts",
        line: 30,
        severity: "Info",
        confidence: "Low",
        message: "Msg3",
        promptForAgents: undefined as any,
      },
    ]);

    expect(octokit.rest.pulls.createReview).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      pull_number: 1,
      commit_id: "headSHA",
      event: "COMMENT",
      body: "Summary text",
      comments: [
        {
          path: "a.ts",
          line: 10,
          side: "RIGHT",
          body: "<!-- jules-inline-comment -->\n**Severity:** 🚨 High | **Confidence:** 🟢 High\n\nMsg\n\n<details>\n<summary>🤖 Prompt for Agents</summary>\n\nFix this issue by doing X\n</details>",
        },
        {
          path: "b.ts",
          line: 20,
          side: "RIGHT",
          body: "<!-- jules-inline-comment -->\n**Severity:** ⚠️ Warning | **Confidence:** 🟡 Medium\n\nMsg2",
        },
        {
          path: "c.ts",
          line: 30,
          side: "RIGHT",
          body: "<!-- jules-inline-comment -->\n**Severity:** ℹ️ Info | **Confidence:** 🔴 Low\n\nMsg3",
        },
      ],
    });
  });

  it("setStatus sets commit status", async () => {
    const octokit = {
      rest: { repos: { createCommitStatus: vi.fn().mockResolvedValue({}) } },
    } as any;
    await setStatus(
      octokit,
      "owner",
      "repo",
      "sha",
      "context",
      "success",
      "desc"
    );
    expect(octokit.rest.repos.createCommitStatus).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      sha: "sha",
      state: "success",
      context: "context",
      description: "desc",
    });
  });
});

describe("extractChangedFilesFromDiff", () => {
  it("should extract standard unquoted file paths", () => {
    const diff = `
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
diff --git a/tests/index.test.ts b/tests/index.test.ts
--- a/tests/index.test.ts
+++ b/tests/index.test.ts
`;
    const files = extractChangedFilesFromDiff(diff);
    expect(files).toEqual(["src/index.ts", "tests/index.test.ts"]);
  });

  it("should extract quoted file paths (e.g. paths with spaces)", () => {
    const diff = `
diff --git "a/src/my file.ts" "b/src/my file.ts"
--- "a/src/my file.ts"
+++ "b/src/my file.ts"
diff --git "a/my project/config.json" "b/my project/config.json"
`;
    const files = extractChangedFilesFromDiff(diff);
    expect(files).toEqual(["src/my file.ts", "my project/config.json"]);
  });

  it("should return unique file paths", () => {
    const diff = `
diff --git a/src/index.ts b/src/index.ts
diff --git a/src/index.ts b/src/index.ts
`;
    const files = extractChangedFilesFromDiff(diff);
    expect(files).toEqual(["src/index.ts"]);
  });

  it("should return empty array if no matches", () => {
    const diff = `
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,3 @@
`;
    const files = extractChangedFilesFromDiff(diff);
    expect(files).toEqual([]);
  });
});
