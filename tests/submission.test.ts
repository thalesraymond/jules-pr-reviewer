/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as core from "@actions/core";
import { submitReview, buildAnnotations } from "../src/submission.js";

vi.mock("@actions/core");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("submission.ts", () => {
  it("submitReview defaults to COMMENT event", async () => {
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

    expect(octokit.rest.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: "COMMENT" })
    );
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

  it("submitReview uses APPROVE event when requested", async () => {
    const octokit = {
      rest: { pulls: { createReview: vi.fn().mockResolvedValue({}) } },
    } as any;
    await submitReview(
      octokit,
      "owner",
      "repo",
      1,
      "headSHA",
      "Summary text",
      [],
      "APPROVE"
    );

    expect(octokit.rest.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: "APPROVE" })
    );
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

  it("summary-only fallback preserves APPROVE event", async () => {
    const error422 = new Error("Unprocessable Entity");
    error422.status = 422;
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(error422)
      .mockResolvedValueOnce({});
    const octokit = { rest: { pulls: { createReview } } } as any;

    await submitReview(
      octokit,
      "owner",
      "repo",
      1,
      "headSHA",
      "Summary text",
      [
        {
          file: "a.ts",
          line: 10,
          severity: "High",
          confidence: "High",
          message: "Msg",
          promptForAgents: "",
        },
      ],
      "APPROVE"
    );

    expect(octokit.rest.pulls.createReview).toHaveBeenCalledTimes(2);
    expect(octokit.rest.pulls.createReview).toHaveBeenNthCalledWith(1, {
      owner: "owner",
      repo: "repo",
      pull_number: 1,
      commit_id: "headSHA",
      event: "APPROVE",
      body: "Summary text",
      comments: [
        {
          path: "a.ts",
          line: 10,
          side: "RIGHT",
          body: "<!-- jules-inline-comment -->\n**Severity:** 🚨 High | **Confidence:** 🟢 High\n\nMsg",
        },
      ],
    });
    expect(octokit.rest.pulls.createReview).toHaveBeenNthCalledWith(2, {
      owner: "owner",
      repo: "repo",
      pull_number: 1,
      commit_id: "headSHA",
      event: "APPROVE",
      body: "Summary text",
      comments: [],
    });
  });
});

describe("buildAnnotations", () => {
  it("maps review comments to annotations", () => {
    const comments = [
      {
        file: "src/a.ts",
        line: 10,
        severity: "High" as const,
        confidence: "High" as const,
        message: "Bug here",
        promptForAgents: "",
      },
      {
        file: "src/b.ts",
        line: 20,
        startLine: 15,
        severity: "Warning" as const,
        confidence: "Medium" as const,
        message: "Consider refactoring",
        promptForAgents: "",
      },
      {
        file: "src/c.ts",
        line: 30,
        severity: "Info" as const,
        confidence: "Low" as const,
        message: "Nit",
        promptForAgents: "",
      },
    ];
    const annotations = buildAnnotations(comments);
    expect(annotations).toEqual([
      {
        path: "src/a.ts",
        startLine: 10,
        endLine: 10,
        annotationLevel: "failure",
        message: "Bug here",
      },
      {
        path: "src/b.ts",
        startLine: 15,
        endLine: 20,
        annotationLevel: "warning",
        message: "Consider refactoring",
      },
      {
        path: "src/c.ts",
        startLine: 30,
        endLine: 30,
        annotationLevel: "notice",
        message: "Nit",
      },
    ]);
  });

  it("limits annotations to 50", () => {
    const comments = Array.from({ length: 60 }, (_, i) => ({
      file: `src/f${i}.ts`,
      line: i + 1,
      severity: "Info" as const,
      confidence: "High" as const,
      message: `Note ${i}`,
      promptForAgents: "",
    }));
    const annotations = buildAnnotations(comments);
    expect(annotations).toHaveLength(50);
  });

  it("returns empty array for empty comments", () => {
    expect(buildAnnotations([])).toEqual([]);
  });
});
