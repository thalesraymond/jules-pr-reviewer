import { describe, it, expect } from "vitest";
import {
  shouldIgnoreTitle,
  shouldIgnoreAuthor,
  evaluateLabelPolicy,
} from "../src/ignore.js";

describe("shouldIgnoreTitle", () => {
  it("returns false for empty title or empty keywords", () => {
    expect(shouldIgnoreTitle("", ["wip"])).toBe(false);
    expect(shouldIgnoreTitle("Some title", [])).toBe(false);
    expect(shouldIgnoreTitle("Some title", undefined)).toBe(false);
  });

  it("matches a keyword as a case-insensitive substring", () => {
    expect(shouldIgnoreTitle("WIP: refactor config", ["wip"])).toBe(true);
    expect(
      shouldIgnoreTitle("Dependabot upgrades lodash", ["dependabot"])
    ).toBe(true);
    expect(shouldIgnoreTitle("Refactor config", ["wip"])).toBe(false);
  });

  it("matches any of several keywords", () => {
    expect(
      shouldIgnoreTitle("chore: bump deps", ["wip", "dependabot", "chore"])
    ).toBe(true);
    expect(shouldIgnoreTitle("feat: add login", ["wip", "dependabot"])).toBe(
      false
    );
  });
});

describe("shouldIgnoreAuthor", () => {
  it("returns false for missing login or empty authors", () => {
    expect(shouldIgnoreAuthor(undefined, ["octocat"])).toBe(false);
    expect(shouldIgnoreAuthor("octocat", [])).toBe(false);
    expect(shouldIgnoreAuthor("octocat", undefined)).toBe(false);
  });

  it("matches the author login case-insensitively", () => {
    expect(shouldIgnoreAuthor("OctoCat", ["octocat"])).toBe(true);
    expect(shouldIgnoreAuthor("octocat", ["OCTOCAT"])).toBe(true);
    expect(shouldIgnoreAuthor("octocat", ["octocat"])).toBe(true);
    expect(shouldIgnoreAuthor("other-user", ["octocat"])).toBe(false);
  });

  it("matches any of several authors", () => {
    expect(
      shouldIgnoreAuthor("dependabot[bot]", ["renovate", "dependabot[bot]"])
    ).toBe(true);
    expect(shouldIgnoreAuthor("alice", ["bob", "carol"])).toBe(false);
  });
});

describe("evaluateLabelPolicy", () => {
  it("is not evaluable when no label filter is configured and never skips", () => {
    const result = evaluateLabelPolicy([{ name: "wip" }], undefined);
    expect(result).toEqual({ evaluable: false, skip: false });
    expect(evaluateLabelPolicy([{ name: "wip" }], [])).toEqual({
      evaluable: false,
      skip: false,
    });
  });

  it("is not evaluable when the payload has no labels field and never skips", () => {
    const result = evaluateLabelPolicy(undefined, ["security"]);
    expect(result.evaluable).toBe(false);
    expect(result.skip).toBe(false);
    expect(result.reason).toContain("did not include PR labels");
  });

  it("skips when a deny label is present", () => {
    const result = evaluateLabelPolicy([{ name: "wip" }], ["-wip"]);
    expect(result).toEqual({
      evaluable: true,
      skip: true,
      reason: expect.stringContaining("which is denied by review_labels"),
    });
  });

  it("does not skip when deny labels are configured but none are present", () => {
    const result = evaluateLabelPolicy([{ name: "docs" }], ["-wip"]);
    expect(result.evaluable).toBe(true);
    expect(result.skip).toBe(false);
  });

  it("skips when allow labels are configured and none are present", () => {
    const result = evaluateLabelPolicy([{ name: "docs" }], ["security"]);
    expect(result.evaluable).toBe(true);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain("none of the allowed review_labels");
  });

  it("skips when allow labels are configured and the PR has no labels at all", () => {
    const result = evaluateLabelPolicy([], ["security"]);
    expect(result.evaluable).toBe(true);
    expect(result.skip).toBe(true);
  });

  it("reviews when the PR has an allowed label and no deny labels", () => {
    const result = evaluateLabelPolicy(
      [{ name: "security" }, { name: "docs" }],
      ["security", "-wip"]
    );
    expect(result.evaluable).toBe(true);
    expect(result.skip).toBe(false);
  });

  it("skips when a deny label is present even if an allow label matches", () => {
    const result = evaluateLabelPolicy(
      [{ name: "security" }, { name: "wip" }],
      ["security", "-wip"]
    );
    expect(result.evaluable).toBe(true);
    expect(result.skip).toBe(true);
  });

  it("matches label names case-insensitively", () => {
    expect(evaluateLabelPolicy([{ name: "SECURITY" }], ["security"]).skip).toBe(
      false
    );
    expect(evaluateLabelPolicy([{ name: "WIP" }], ["-wip"]).skip).toBe(true);
  });

  it("ignores bare dash entries after stripping the deny prefix", () => {
    const result = evaluateLabelPolicy([{ name: "docs" }], ["-", "docs"]);
    expect(result.evaluable).toBe(true);
    expect(result.skip).toBe(false);
  });
});
