import { describe, it, expect } from "vitest";
import {
  buildPostedCoverageNote,
  preparePromptDiff,
  splitDiffSections,
} from "../src/coverage.js";

function makeDiffSection(path: string, contentChars: number): string {
  const header = `diff --git a/${path} b/${path}\nindex 123..456 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n+`;
  return header + "x".repeat(contentChars) + "\n";
}

const BIG = makeDiffSection("src/big.ts", 60_000);
const MID = makeDiffSection("src/mid.ts", 30_000);
const SMALL = makeDiffSection("src/small.ts", 10_000);
const THREE_FILE_DIFF = BIG + MID + SMALL;
const BUDGET = 80_000;

describe("splitDiffSections", () => {
  it("splits a multi-file diff into per-file sections", () => {
    const sections = splitDiffSections(THREE_FILE_DIFF);
    expect(sections.map((s) => s.path)).toEqual([
      "src/big.ts",
      "src/mid.ts",
      "src/small.ts",
    ]);
    expect(sections[0].text).toBe(BIG);
  });

  it("uses the a-side path for renames", () => {
    const diff =
      "diff --git a/old.ts b/new.ts\nindex 1..2 100644\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-x\n+y\n";
    const sections = splitDiffSections(diff);
    expect(sections).toHaveLength(1);
    expect(sections[0].path).toBe("old.ts");
  });

  it("returns an empty array for an empty diff", () => {
    expect(splitDiffSections("")).toEqual([]);
  });

  it("skips content without a diff --git header", () => {
    const sections = splitDiffSections("no header here\n" + BIG);
    expect(sections).toHaveLength(1);
    expect(sections[0].path).toBe("src/big.ts");
  });
});

describe("preparePromptDiff", () => {
  it("returns the diff unchanged when it fits within the budget", () => {
    const result = preparePromptDiff(SMALL, BUDGET, "prioritize");
    expect(result.diff).toBe(SMALL);
    expect(result.coverage).toBeUndefined();
    expect(result.diffTruncatedNote).toBeUndefined();
  });

  it("selects the highest-churn files that fit and lists the rest as excluded (prioritize)", () => {
    const result = preparePromptDiff(THREE_FILE_DIFF, BUDGET, "prioritize");
    expect(result.diffTruncatedNote).toBeUndefined();
    expect(result.coverage).toMatchObject({
      isLarge: true,
      totalFiles: 3,
      reviewedFiles: 2,
      includedFiles: ["src/big.ts", "src/small.ts"],
      partialFiles: [],
      excludedFiles: ["src/mid.ts"],
    });
    expect(result.diff).toContain("a/src/big.ts");
    expect(result.diff).toContain("a/src/small.ts");
    expect(result.diff).not.toContain("a/src/mid.ts");
  });

  it("keeps original diff order and reports a straddling file as partial (truncate)", () => {
    const result = preparePromptDiff(THREE_FILE_DIFF, BUDGET, "truncate");
    expect(result.diff).toBe(THREE_FILE_DIFF.slice(0, BUDGET));
    expect(result.diffTruncatedNote).toContain(
      "The diff was truncated: original"
    );
    expect(result.coverage).toMatchObject({
      isLarge: true,
      totalFiles: 3,
      includedFiles: ["src/big.ts"],
      partialFiles: ["src/mid.ts"],
      excludedFiles: ["src/small.ts"],
      reviewedFiles: 2,
    });
  });

  it("falls back to raw truncation with a note when the diff has no sections", () => {
    const huge = "x".repeat(81_000);
    const result = preparePromptDiff(huge, BUDGET, "prioritize");
    expect(result.diff).toBe(huge.slice(0, BUDGET));
    expect(result.diffTruncatedNote).toContain(
      "The diff was truncated: original 81000 chars, kept first 80000."
    );
    expect(result.coverage).toMatchObject({ isLarge: true, totalFiles: 0 });
    expect(result.coverage?.reviewedFiles).toBeUndefined();
  });

  it("groups repeated sections for the same path into one section", () => {
    const first = makeDiffSection("src/dup.ts", 100);
    const second = makeDiffSection("src/dup.ts", 200);
    const sections = splitDiffSections(first + second);
    expect(sections).toHaveLength(1);
    expect(sections[0].path).toBe("src/dup.ts");
    expect(sections[0].text).toBe(first + second);
  });

  it("counts a duplicated path once when reporting coverage", () => {
    const dupBig = makeDiffSection("src/dup.ts", 60_000);
    const dupMore = makeDiffSection("src/dup.ts", 30_000);
    const small = makeDiffSection("src/small.ts", 10_000);
    const result = preparePromptDiff(
      dupBig + dupMore + small,
      BUDGET,
      "prioritize"
    );
    expect(result.coverage).toMatchObject({
      isLarge: true,
      totalFiles: 2,
      reviewedFiles: 1,
      partialFiles: ["src/dup.ts"],
      excludedFiles: ["src/small.ts"],
    });
  });

  it("marks a single oversized file as partially reviewed instead of dropping it", () => {
    const oversized = makeDiffSection("src/huge.ts", 150_000);
    const result = preparePromptDiff(oversized, BUDGET, "prioritize");
    expect(result.diff.length).toBeLessThanOrEqual(BUDGET);
    expect(result.coverage).toMatchObject({
      isLarge: true,
      totalFiles: 1,
      reviewedFiles: 1,
      includedFiles: [],
      partialFiles: ["src/huge.ts"],
      excludedFiles: [],
    });
  });
});

describe("buildPostedCoverageNote", () => {
  it("returns undefined for undefined coverage", () => {
    expect(buildPostedCoverageNote(undefined)).toBeUndefined();
  });

  it("returns undefined when the PR is not large", () => {
    const coverage = {
      isLarge: false,
      totalFiles: 2,
      reviewedFiles: 2,
      includedFiles: ["a.ts", "b.ts"],
      partialFiles: [],
      excludedFiles: [],
    };
    expect(buildPostedCoverageNote(coverage)).toBeUndefined();
  });

  it("returns undefined in agentic mode where reviewedFiles is unknown", () => {
    const coverage = {
      isLarge: true,
      totalFiles: 5,
      includedFiles: [],
      partialFiles: [],
      excludedFiles: [],
    };
    expect(buildPostedCoverageNote(coverage)).toBeUndefined();
  });

  it("states reviewed count and lists uncovered files for a large prompt-mode review", () => {
    const coverage = {
      isLarge: true,
      totalFiles: 3,
      reviewedFiles: 2,
      includedFiles: ["src/big.ts", "src/small.ts"],
      partialFiles: [],
      excludedFiles: ["src/mid.ts"],
    };
    const note = buildPostedCoverageNote(coverage);
    expect(note).toContain("reviewed 2 of 3 changed files");
    expect(note).toContain("src/mid.ts");
  });

  it("mentions a partial file when one was truncated", () => {
    const coverage = {
      isLarge: true,
      totalFiles: 2,
      reviewedFiles: 2,
      includedFiles: ["src/big.ts"],
      partialFiles: ["src/mid.ts"],
      excludedFiles: [],
    };
    const note = buildPostedCoverageNote(coverage);
    expect(note).toContain("partially");
  });
});
