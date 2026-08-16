import { describe, it, expect } from "vitest";
import { filterCommentsByStrictness } from "../src/strictness.js";
import type { ReviewComment } from "../src/types.js";

const comment = (
  severity: ReviewComment["severity"],
  confidence: ReviewComment["confidence"] = "High"
): ReviewComment => ({
  file: "src/a.ts",
  line: 10,
  severity,
  confidence,
  message: `Issue (${severity})`,
  promptForAgents: "",
});

describe("filterCommentsByStrictness", () => {
  it("quiet keeps only High findings, preserving order", () => {
    const comments = [
      comment("High"),
      comment("Warning"),
      comment("Info"),
      comment("High"),
    ];

    const filtered = filterCommentsByStrictness(comments, "quiet");

    expect(filtered).toHaveLength(2);
    expect(filtered.every((c) => c.severity === "High")).toBe(true);
    expect(filtered[0].message).toBe("Issue (High)");
    expect(filtered[1].message).toBe("Issue (High)");
  });

  it("chill keeps all findings unchanged", () => {
    const comments = [comment("High"), comment("Warning"), comment("Info")];

    expect(filterCommentsByStrictness(comments, "chill")).toEqual(comments);
  });

  it("assertive keeps all findings unchanged", () => {
    const comments = [comment("High"), comment("Warning"), comment("Info")];

    expect(filterCommentsByStrictness(comments, "assertive")).toEqual(comments);
  });

  it("returns an empty array for empty input", () => {
    expect(filterCommentsByStrictness([], "quiet")).toEqual([]);
    expect(filterCommentsByStrictness([], "chill")).toEqual([]);
    expect(filterCommentsByStrictness([], "assertive")).toEqual([]);
  });
});
