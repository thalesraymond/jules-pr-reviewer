/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as core from "@actions/core";
import {
  fetchDiff,
  loadRulesFromBase,
  resolveThreads,
  setStatus,
  submitReview,
  fetchOpenThreads,
} from "../src/github.js";

vi.mock("@actions/core");

beforeEach(() => {
  vi.clearAllMocks();
});

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
                        viewerDidAuthor: true,
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
                      {
                        body: "Normal user comment",
                        path: "c.ts",
                        line: 30,
                        viewerDidAuthor: false,
                      },
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
                        viewerDidAuthor: true,
                      },
                    ],
                  },
                },
                {
                  id: "t6",
                  isResolved: false,
                  comments: {
                    nodes: [
                      {
                        body: "<!-- jules-inline-comment -->\nSpoofed Comment",
                        path: "e.ts",
                        line: 40,
                        author: { login: "attacker" },
                        viewerDidAuthor: false,
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
    // Fast mock for withRetry delay so we don't hit the 5000ms Vitest timeout
    vi.useFakeTimers();

    const octokit = {
      graphql: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValue(new Error("fail")), // The first thread succeeds, second thread fails and retries
    } as any;

    const resolvePromise = resolveThreads(octokit, ["t1", "t2"]);

    // Fast-forward timers to skip the delay in withRetry
    await vi.runAllTimersAsync();

    await resolvePromise;
    expect(octokit.graphql).toHaveBeenCalledTimes(5);
    vi.useRealTimers();
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

  it("submitReview falls back to summary-only review on 422 error", async () => {
    const error422 = new Error("Unprocessable Entity");
    (error422 as any).status = 422;
    const octokit = {
      rest: {
        pulls: {
          createReview: vi
            .fn()
            .mockRejectedValueOnce(error422) // Primary fails
            .mockResolvedValueOnce({}), // Fallback succeeds
        },
      },
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
    ]);

    expect(octokit.rest.pulls.createReview).toHaveBeenCalledTimes(2);
    expect(octokit.rest.pulls.createReview).toHaveBeenNthCalledWith(1, {
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
      ],
    });
    expect(octokit.rest.pulls.createReview).toHaveBeenNthCalledWith(2, {
      owner: "owner",
      repo: "repo",
      pull_number: 1,
      commit_id: "headSHA",
      event: "COMMENT",
      body: "Summary text",
      comments: [],
    });
  });

  it("comments without suggestion/startLine fields behave exactly as before", async () => {
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
      ],
    });
  });

  it("comment with suggestion includes attribution note and suggestion block", async () => {
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
        promptForAgents: "Agent prompt",
        suggestion: "const x = 1;",
      },
    ]);

    const body =
      octokit.rest.pulls.createReview.mock.calls[0][0].comments[0].body;
    expect(body).toContain(
      "> ⚠️ Jules suggested this fix — review carefully before applying."
    );
    expect(body).toContain("```suggestion\nconst x = 1;\n```");
    expect(body).toContain("Agent prompt");
    expect(body.indexOf("Agent prompt")).toBeGreaterThan(
      body.indexOf("```suggestion")
    );
  });

  it("comment without suggestion does not contain suggestion block or attribution", async () => {
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
        promptForAgents: "",
      },
    ]);

    const body =
      octokit.rest.pulls.createReview.mock.calls[0][0].comments[0].body;
    expect(body).not.toContain(
      "Jules suggested this fix — review carefully before applying"
    );
    expect(body).not.toContain("```suggestion");
  });

  it("discards startLine when startLine > line", async () => {
    const octokit = {
      rest: { pulls: { createReview: vi.fn().mockResolvedValue({}) } },
    } as any;
    await submitReview(octokit, "owner", "repo", 1, "headSHA", "Summary text", [
      {
        file: "a.ts",
        line: 10,
        startLine: 20,
        severity: "High",
        confidence: "High",
        message: "Msg",
        promptForAgents: "",
        suggestion: "const x = 1;",
      },
    ]);

    const apiComment =
      octokit.rest.pulls.createReview.mock.calls[0][0].comments[0];
    expect(apiComment.start_line).toBeUndefined();
  });

  it("escapes triple backticks in suggestion", async () => {
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
        promptForAgents: "",
        suggestion: "const x = ```code```;",
      },
    ]);

    const body =
      octokit.rest.pulls.createReview.mock.calls[0][0].comments[0].body;
    expect(body).toContain("const x = '''code''';");
    expect(body).not.toContain("const x = ```code```;");
  });

  it("passes start_line to API when valid", async () => {
    const octokit = {
      rest: { pulls: { createReview: vi.fn().mockResolvedValue({}) } },
    } as any;
    await submitReview(octokit, "owner", "repo", 1, "headSHA", "Summary text", [
      {
        file: "a.ts",
        line: 12,
        startLine: 8,
        severity: "High",
        confidence: "High",
        message: "Msg",
        promptForAgents: "",
        suggestion: "const x = 1;",
      },
    ]);

    const apiComment =
      octokit.rest.pulls.createReview.mock.calls[0][0].comments[0];
    expect(apiComment).toMatchObject({
      path: "a.ts",
      line: 12,
      start_line: 8,
      side: "RIGHT",
    });
  });

  it("Tier 1 succeeds with suggestion blocks intact", async () => {
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
        promptForAgents: "",
        suggestion: "const x = 1;",
      },
    ]);

    expect(octokit.rest.pulls.createReview).toHaveBeenCalledTimes(1);
    const apiComment =
      octokit.rest.pulls.createReview.mock.calls[0][0].comments[0];
    expect(apiComment.body).toContain("```suggestion");
  });

  it("Tier 1 fail -> Tier 2 strips suggestions and emits warning", async () => {
    const error422 = new Error("Unprocessable Entity");
    error422.status = 422;
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(error422)
      .mockResolvedValueOnce({});
    const octokit = { rest: { pulls: { createReview } } } as any;
    await submitReview(octokit, "owner", "repo", 1, "headSHA", "Summary text", [
      {
        file: "a.ts",
        line: 10,
        severity: "High",
        confidence: "High",
        message: "Msg",
        promptForAgents: "",
        suggestion: "const x = 1;",
      },
    ]);

    expect(octokit.rest.pulls.createReview).toHaveBeenCalledTimes(2);
    expect(
      octokit.rest.pulls.createReview.mock.calls[0][0].comments[0].body
    ).toContain("```suggestion");
    expect(
      octokit.rest.pulls.createReview.mock.calls[1][0].comments[0].body
    ).not.toContain("```suggestion");
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Retrying without suggestions")
    );
  });

  it("Tier 1 fail -> Tier 2 fail -> Tier 3 summary-only fallback", async () => {
    const error422 = new Error("Unprocessable Entity");
    error422.status = 422;
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(error422)
      .mockRejectedValueOnce(error422)
      .mockResolvedValueOnce({});
    const octokit = { rest: { pulls: { createReview } } } as any;

    await submitReview(octokit, "owner", "repo", 1, "headSHA", "Summary text", [
      {
        file: "a.ts",
        line: 10,
        severity: "High",
        confidence: "High",
        message: "Msg",
        promptForAgents: "",
        suggestion: "const x = 1;",
      },
    ]);

    expect(octokit.rest.pulls.createReview).toHaveBeenCalledTimes(3);
    expect(
      octokit.rest.pulls.createReview.mock.calls[2][0].comments
    ).toHaveLength(0);
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

  it("setStatus handles failures gracefully with retries", async () => {
    vi.useFakeTimers();
    const octokit = {
      rest: {
        repos: {
          createCommitStatus: vi.fn().mockRejectedValue(new Error("fail")),
        },
      },
    } as any;

    const setStatusPromise = setStatus(
      octokit,
      "owner",
      "repo",
      "sha",
      "context",
      "success",
      "desc"
    ).catch(() => {}); // Catch the thrown error after retries are exhausted

    await vi.runAllTimersAsync();
    await setStatusPromise;

    expect(octokit.rest.repos.createCommitStatus).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    vi.useRealTimers();
  });
});
