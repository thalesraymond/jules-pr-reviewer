import { describe, it, expect } from "vitest";
import {
  evaluateSkipPolicy,
  type PullRequestForSkipPolicy,
  type SkipPolicyConfig,
} from "../src/skipPolicy.js";

const baseConfig: SkipPolicyConfig = {
  skipDrafts: false,
  skipForks: false,
  bypassLabel: "",
  ignoreTitleKeywords: "",
  ignoreAuthors: "",
  reviewLabels: "",
};

const basePr: PullRequestForSkipPolicy = {
  draft: false,
  head: { repo: { full_name: "owner/repo" } },
  title: "Add feature",
  user: { login: "octocat" },
  labels: [],
};

describe("evaluateSkipPolicy", () => {
  it("does not skip by default", () => {
    const result = evaluateSkipPolicy(basePr, baseConfig, "owner/repo");
    expect(result).toEqual({ skip: false });
  });

  it("skips draft PRs when skip_drafts is true", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, draft: true },
      { ...baseConfig, skipDrafts: true },
      "owner/repo"
    );
    expect(result).toEqual({ skip: true, reason: "Skipping draft PR." });
  });

  it("does not skip drafts when skip_drafts is false", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, draft: true },
      { ...baseConfig, skipDrafts: false },
      "owner/repo"
    );
    expect(result).toEqual({ skip: false });
  });

  it("skips fork PRs when skip_forks is true", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, head: { repo: { full_name: "fork/repo" } } },
      { ...baseConfig, skipForks: true },
      "owner/repo"
    );
    expect(result).toEqual({
      skip: true,
      reason: "Skipping fork PR (skip_forks=true).",
    });
  });

  it("does not skip forks when skip_forks is false", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, head: { repo: { full_name: "fork/repo" } } },
      { ...baseConfig, skipForks: false },
      "owner/repo"
    );
    expect(result).toEqual({ skip: false });
  });

  it("skips when the bypass label is present", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, labels: [{ name: "skip-review" }] },
      { ...baseConfig, bypassLabel: "skip-review" },
      "owner/repo"
    );
    expect(result).toEqual({
      skip: true,
      reason: 'Bypass label "skip-review" present — skipping review.',
    });
  });

  it("skips when a title keyword matches", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, title: "WIP: feature draft" },
      { ...baseConfig, ignoreTitleKeywords: "wip, do not review" },
      "owner/repo"
    );
    expect(result).toEqual({
      skip: true,
      reason:
        "PR title matches an ignore_title_keywords entry — skipping review.",
    });
  });

  it("does not skip when no title keyword matches", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, title: "Add login flow" },
      { ...baseConfig, ignoreTitleKeywords: "wip" },
      "owner/repo"
    );
    expect(result).toEqual({ skip: false });
  });

  it("skips when the author is in ignore_authors", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, user: { login: "OctoCat" } },
      { ...baseConfig, ignoreAuthors: "octocat, bot[bot]" },
      "owner/repo"
    );
    expect(result).toEqual({
      skip: true,
      reason: 'PR author "OctoCat" is in ignore_authors — skipping review.',
    });
  });

  it("does not skip when the author is not in ignore_authors", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, user: { login: "octocat" } },
      { ...baseConfig, ignoreAuthors: "bot[bot]" },
      "owner/repo"
    );
    expect(result).toEqual({ skip: false });
  });

  it("skips when a deny review_label is present", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, labels: [{ name: "WIP" }] },
      { ...baseConfig, reviewLabels: '["-wip"]' },
      "owner/repo"
    );
    expect(result).toEqual({
      skip: true,
      reason: expect.stringContaining("which is denied by review_labels"),
    });
  });

  it("skips when the PR has none of the allowed review_labels", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, labels: [{ name: "docs" }] },
      { ...baseConfig, reviewLabels: '["security"]' },
      "owner/repo"
    );
    expect(result).toEqual({
      skip: true,
      reason: expect.stringContaining("none of the allowed review_labels"),
    });
  });

  it("does not skip when the PR has an allowed review_label and no deny labels", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, labels: [{ name: "security" }] },
      { ...baseConfig, reviewLabels: '["security", "-wip"]' },
      "owner/repo"
    );
    expect(result).toEqual({ skip: false });
  });

  it("does not skip when only deny review_labels are configured and none are present", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, labels: [] },
      { ...baseConfig, reviewLabels: '["-wip"]' },
      "owner/repo"
    );
    expect(result).toEqual({ skip: false });
  });

  it("warns when review_labels cannot be evaluated (labels missing from payload)", () => {
    const result = evaluateSkipPolicy(
      { ...basePr, labels: undefined },
      { ...baseConfig, reviewLabels: '["security"]' },
      "owner/repo"
    );
    expect(result.skip).toBe(false);
    expect(result.warning).toContain(
      "review_labels cannot be evaluated: the event payload did not include PR labels (labels are not guaranteed in pull_request payloads). Continuing the review."
    );
  });

  it("returns the first matching skip reason in priority order", () => {
    const result = evaluateSkipPolicy(
      {
        ...basePr,
        draft: true,
        title: "WIP: draft",
        labels: [{ name: "skip-review" }],
      },
      {
        ...baseConfig,
        skipDrafts: true,
        bypassLabel: "skip-review",
        ignoreTitleKeywords: "wip",
      },
      "owner/repo"
    );
    expect(result).toEqual({ skip: true, reason: "Skipping draft PR." });
  });
});
