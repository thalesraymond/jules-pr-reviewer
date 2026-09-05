import { describe, it, expect } from "vitest";
import {
  parseSeverityGate,
  severityAtLeast,
  filterCommentsBySeverity,
  hasFindingsAtOrAbove,
  conclusionFromVerdict,
  conclusionFromFindings,
} from "../src/severity.js";
import { ReviewComment } from "../src/types.js";

const comment = (severity: ReviewComment["severity"]): ReviewComment => ({
  file: "a.ts",
  line: 1,
  severity,
  confidence: "High",
  message: "msg",
  promptForAgents: "",
});

describe("parseSeverityGate", () => {
  it("parses valid severity gates to Severity values", () => {
    expect(parseSeverityGate("high")).toBe("High");
    expect(parseSeverityGate("warning")).toBe("Warning");
    expect(parseSeverityGate("info")).toBe("Info");
  });

  it("accepts case-insensitive input", () => {
    expect(parseSeverityGate("HIGH")).toBe("High");
    expect(parseSeverityGate("Info")).toBe("Info");
  });

  it("returns undefined for empty or invalid values", () => {
    expect(parseSeverityGate("")).toBeUndefined();
    expect(parseSeverityGate("critical")).toBeUndefined();
    expect(parseSeverityGate("block")).toBeUndefined();
  });
});

describe("severityAtLeast", () => {
  it("orders Info below Warning below High", () => {
    expect(severityAtLeast("Info", "Info")).toBe(true);
    expect(severityAtLeast("Info", "Warning")).toBe(false);
    expect(severityAtLeast("Info", "High")).toBe(false);
    expect(severityAtLeast("Warning", "Warning")).toBe(true);
    expect(severityAtLeast("Warning", "High")).toBe(false);
    expect(severityAtLeast("High", "High")).toBe(true);
    expect(severityAtLeast("High", "Warning")).toBe(true);
    expect(severityAtLeast("High", "Info")).toBe(true);
  });
});

describe("filterCommentsBySeverity", () => {
  it("keeps all comments when the minimum is Info", () => {
    const comments = [comment("High"), comment("Warning"), comment("Info")];
    expect(filterCommentsBySeverity(comments, "Info")).toHaveLength(3);
  });

  it("drops Info comments when the minimum is Warning", () => {
    const comments = [comment("High"), comment("Warning"), comment("Info")];
    const filtered = filterCommentsBySeverity(comments, "Warning");
    expect(filtered).toEqual([comment("High"), comment("Warning")]);
  });

  it("keeps only High comments when the minimum is High", () => {
    const comments = [comment("High"), comment("Warning"), comment("Info")];
    expect(filterCommentsBySeverity(comments, "High")).toEqual([
      comment("High"),
    ]);
  });

  it("returns an empty array for empty comments", () => {
    expect(filterCommentsBySeverity([], "High")).toEqual([]);
  });
});

describe("hasFindingsAtOrAbove", () => {
  it("is true when a finding reaches the severity", () => {
    expect(
      hasFindingsAtOrAbove([comment("Info"), comment("High")], "High")
    ).toBe(true);
    expect(hasFindingsAtOrAbove([comment("Warning")], "Warning")).toBe(true);
  });

  it("is false when no finding reaches the severity", () => {
    expect(
      hasFindingsAtOrAbove([comment("Info"), comment("Warning")], "High")
    ).toBe(false);
    expect(hasFindingsAtOrAbove([], "High")).toBe(false);
  });
});

describe("conclusionFromVerdict", () => {
  it("returns failure conclusion with Invalid review verdict when verdict is invalid", () => {
    const result = conclusionFromVerdict(
      "invalid-verdict" as "approve",
      "blocking"
    );
    expect(result).toEqual({
      conclusion: "failure",
      description: "Invalid review verdict",
    });
  });

  it("succeeds when fail_on is never", () => {
    const result = conclusionFromVerdict("comment", "never");
    expect(result.conclusion).toBe("success");
    expect(result.description).toContain("complete (verdict: comment)");
  });

  it("succeeds for approve when fail_on is any", () => {
    const result = conclusionFromVerdict("approve", "any");
    expect(result).toEqual({
      conclusion: "success",
      description: "Approved",
    });
  });

  it("fails for comment when fail_on is any", () => {
    const result = conclusionFromVerdict("comment", "any");
    expect(result).toEqual({
      conclusion: "failure",
      description: "Review verdict: comment",
    });
  });

  it("succeeds for comment when fail_on is blocking", () => {
    const result = conclusionFromVerdict("comment", "blocking");
    expect(result.conclusion).toBe("success");
  });

  it("fails for block when fail_on is blocking", () => {
    const result = conclusionFromVerdict("block", "blocking");
    expect(result).toEqual({
      conclusion: "failure",
      description: "Blocking issues found",
    });
  });
});

describe("conclusionFromFindings", () => {
  it("fails when a finding is at or above block_on severity", () => {
    expect(
      conclusionFromFindings([comment("Warning"), comment("High")], "High")
    ).toEqual({
      conclusion: "failure",
      description: "Findings at or above high severity found",
    });
    expect(conclusionFromFindings([comment("Info")], "Info")).toEqual({
      conclusion: "failure",
      description: "Findings at or above info severity found",
    });
  });

  it("succeeds when no finding reaches block_on severity", () => {
    expect(conclusionFromFindings([comment("Info")], "High")).toEqual({
      conclusion: "success",
      description: "No findings at or above high severity",
    });
    expect(conclusionFromFindings([], "Warning")).toEqual({
      conclusion: "success",
      description: "No findings at or above warning severity",
    });
  });
});
