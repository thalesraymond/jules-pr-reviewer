/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchDiff,
  loadRulesFromBase,
  resolveThreads,
  createCheckRun,
  finalizeCheckRun,
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

  it("createCheckRun creates a check run and returns the ID", async () => {
    const octokit = {
      rest: {
        checks: {
          create: vi.fn().mockResolvedValue({ data: { id: 42 } }),
        },
      },
    } as any;
    const id = await createCheckRun(
      octokit,
      "owner",
      "repo",
      "jules/review",
      "sha"
    );
    expect(id).toBe(42);
    expect(octokit.rest.checks.create).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      name: "jules/review",
      head_sha: "sha",
      status: "in_progress",
    });
  });

  it("createCheckRun handles failures gracefully with retries", async () => {
    vi.useFakeTimers();
    const octokit = {
      rest: {
        checks: {
          create: vi.fn().mockRejectedValue(new Error("fail")),
        },
      },
    } as any;

    const createPromise = createCheckRun(
      octokit,
      "owner",
      "repo",
      "jules/review",
      "sha"
    ).catch(() => {});

    await vi.runAllTimersAsync();
    await createPromise;

    expect(octokit.rest.checks.create).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it("finalizeCheckRun updates a check run with conclusion and output", async () => {
    const octokit = {
      rest: {
        checks: {
          update: vi.fn().mockResolvedValue({}),
        },
      },
    } as any;
    await finalizeCheckRun(octokit, "owner", "repo", 42, "success", {
      title: "Jules Review",
      summary: "All good",
      annotations: [
        {
          path: "src/a.ts",
          startLine: 10,
          endLine: 10,
          annotationLevel: "warning",
          message: "Watch out",
          title: "High severity",
        },
      ],
    });
    expect(octokit.rest.checks.update).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      check_run_id: 42,
      status: "completed",
      conclusion: "success",
      output: {
        title: "Jules Review",
        summary: "All good",
        annotations: [
          {
            path: "src/a.ts",
            start_line: 10,
            end_line: 10,
            annotation_level: "warning",
            message: "Watch out",
            title: "High severity",
          },
        ],
      },
    });
  });

  it("finalizeCheckRun works without annotations", async () => {
    const octokit = {
      rest: {
        checks: {
          update: vi.fn().mockResolvedValue({}),
        },
      },
    } as any;
    await finalizeCheckRun(octokit, "owner", "repo", 42, "failure", {
      title: "Jules Review",
      summary: "Issues found",
    });
    expect(octokit.rest.checks.update).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      check_run_id: 42,
      status: "completed",
      conclusion: "failure",
      output: {
        title: "Jules Review",
        summary: "Issues found",
      },
    });
  });

  it("finalizeCheckRun handles failures gracefully with retries", async () => {
    vi.useFakeTimers();
    const octokit = {
      rest: {
        checks: {
          update: vi.fn().mockRejectedValue(new Error("fail")),
        },
      },
    } as any;

    const updatePromise = finalizeCheckRun(
      octokit,
      "owner",
      "repo",
      42,
      "success",
      { title: "T", summary: "S" }
    ).catch(() => {});

    await vi.runAllTimersAsync();
    await updatePromise;

    expect(octokit.rest.checks.update).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
