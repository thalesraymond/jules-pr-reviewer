import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadCases,
  compareFindings,
  scoreReview,
  defaultMockReview,
  runEvaluation,
  formatMarkdownReport,
  type EvalCase,
  type ReviewResult,
} from "../src/evaluator.js";

describe("evaluator.ts", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jules-eval-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeFixture(name: string, content: unknown): Promise<void> {
    await fs.writeFile(
      path.join(tmpDir, name),
      JSON.stringify(content, null, 2),
      "utf-8"
    );
  }

  function makeComment(
    overrides: Partial<{
      file: string;
      line: number;
      severity: "High" | "Warning" | "Info";
      message: string;
    }>
  ) {
    return {
      file: "src/db.js",
      line: 4,
      severity: "High" as const,
      confidence: "High" as const,
      message: "SQL injection risk.",
      promptForAgents: "Fix it.",
      ...overrides,
    };
  }

  describe("loadCases", () => {
    it("loads and validates valid fixtures", async () => {
      await writeFixture("case-a.json", {
        prNumber: 1,
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: [{ file: "f.ts", line: 1, severity: "High" }],
        tags: ["security"],
      });

      const cases = await loadCases(tmpDir);
      expect(cases).toHaveLength(1);
      expect(cases[0]).toMatchObject({
        prNumber: 1,
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: [{ file: "f.ts", line: 1, severity: "High" }],
        tags: ["security"],
      });
    });

    it("ignores non-JSON files", async () => {
      await writeFixture("case-a.json", {
        prNumber: 1,
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: [],
      });
      await fs.writeFile(path.join(tmpDir, "readme.md"), "# docs", "utf-8");

      const cases = await loadCases(tmpDir);
      expect(cases).toHaveLength(1);
    });

    it("sorts fixtures alphabetically", async () => {
      await writeFixture("z.json", {
        prNumber: 2,
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: [],
      });
      await writeFixture("a.json", {
        prNumber: 1,
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: [],
      });

      const cases = await loadCases(tmpDir);
      expect(cases.map((c) => c.prNumber)).toEqual([1, 2]);
    });

    it("throws when prNumber is missing", async () => {
      await writeFixture("bad.json", {
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: [],
      });

      await expect(loadCases(tmpDir)).rejects.toThrow("prNumber");
    });

    it("throws when expectedFindings is not an array", async () => {
      await writeFixture("bad.json", {
        prNumber: 1,
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: "none",
      });

      await expect(loadCases(tmpDir)).rejects.toThrow("expectedFindings");
    });

    it("throws when expected finding has invalid severity", async () => {
      await writeFixture("bad.json", {
        prNumber: 1,
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: [{ file: "f.ts", line: 1, severity: "Critical" }],
      });

      await expect(loadCases(tmpDir)).rejects.toThrow("severity");
    });

    it("throws when fixture is not an object", async () => {
      await writeFixture("bad.json", "not-an-object");

      await expect(loadCases(tmpDir)).rejects.toThrow("not a JSON object");
    });
  });

  describe("compareFindings", () => {
    it("marks identical findings as true positives", () => {
      const actual = [makeComment({})];
      const expected = [
        { file: "src/db.js", line: 4, severity: "High" as const },
      ];

      const result = compareFindings(actual, expected);
      expect(result.truePositives).toBe(1);
      expect(result.falsePositives).toBe(0);
      expect(result.falseNegatives).toBe(0);
      expect(result.precision).toBe(1);
      expect(result.recall).toBe(1);
      expect(result.f1).toBe(1);
      expect(result.matchedComments).toHaveLength(1);
      expect(result.unmatchedComments).toHaveLength(0);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it("treats unexpected comments as false positives", () => {
      const actual = [makeComment({})];
      const expected: EvalCase["expectedFindings"] = [];

      const result = compareFindings(actual, expected);
      expect(result.truePositives).toBe(0);
      expect(result.falsePositives).toBe(1);
      expect(result.falseNegatives).toBe(0);
      expect(result.precision).toBe(0);
      expect(result.recall).toBe(0);
    });

    it("treats missing expected findings as false negatives", () => {
      const actual: ReturnType<typeof makeComment>[] = [];
      const expected = [
        { file: "src/db.js", line: 4, severity: "High" as const },
      ];

      const result = compareFindings(actual, expected);
      expect(result.truePositives).toBe(0);
      expect(result.falsePositives).toBe(0);
      expect(result.falseNegatives).toBe(1);
      expect(result.precision).toBe(0);
      expect(result.recall).toBe(0);
    });

    it("matches by message substring when provided", () => {
      const actual = [makeComment({ message: "SQL injection risk here" })];
      const expected = [
        {
          file: "src/db.js",
          line: 4,
          severity: "High" as const,
          message: "SQL injection",
        },
      ];

      const result = compareFindings(actual, expected);
      expect(result.truePositives).toBe(1);
    });

    it("treats same location with mismatched message as false positive", () => {
      const actual = [makeComment({ message: "SQL injection risk here" })];
      const expected = [
        {
          file: "src/db.js",
          line: 4,
          severity: "High" as const,
          message: "SQL injection",
        },
      ];

      const result = compareFindings(actual, expected);
      expect(result.truePositives).toBe(1);

      const noMatch = compareFindings(
        [makeComment({ message: "wrong message" })],
        expected
      );
      expect(noMatch.truePositives).toBe(0);
      expect(noMatch.falsePositives).toBe(1);
      expect(noMatch.falseNegatives).toBe(1);
    });

    it("requires exact file, line, and severity match", () => {
      const expected = [
        { file: "src/db.js", line: 4, severity: "High" as const },
      ];

      expect(
        compareFindings([makeComment({ file: "other.js" })], expected)
          .truePositives
      ).toBe(0);
      expect(
        compareFindings([makeComment({ line: 5 })], expected).truePositives
      ).toBe(0);
      expect(
        compareFindings([makeComment({ severity: "Warning" })], expected)
          .truePositives
      ).toBe(0);
    });
  });

  describe("scoreReview", () => {
    it("delegates to compareFindings", () => {
      const evalCase: EvalCase = {
        prNumber: 1,
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: [{ file: "src/db.js", line: 4, severity: "High" }],
      };
      const reviewResult: ReviewResult = {
        summary: "s",
        verdict: "block",
        resolvedCommentIds: [],
        newComments: [makeComment({})],
      };

      const result = scoreReview(evalCase, reviewResult);
      expect(result.truePositives).toBe(1);
    });
  });

  describe("defaultMockReview", () => {
    it("returns empty review when no mockResponse is provided", async () => {
      const evalCase: EvalCase = {
        prNumber: 1,
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: [],
      };

      const result = await defaultMockReview(evalCase);
      expect(result.verdict).toBe("approve");
      expect(result.newComments).toHaveLength(0);
    });

    it("parses a mock JSON response", async () => {
      const evalCase: EvalCase = {
        prNumber: 1,
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: [],
        mockResponse:
          '{"summary":"s","verdict":"comment","resolvedCommentIds":[],"newComments":[]}',
      };

      const result = await defaultMockReview(evalCase);
      expect(result.verdict).toBe("comment");
      expect(result.summary).toBe("s");
    });
  });

  describe("runEvaluation", () => {
    it("throws for live mode", async () => {
      await expect(
        runEvaluation({ mode: "live", casesDir: tmpDir })
      ).rejects.toThrow("Live evaluation requires explicit opt-in");
    });

    it("returns aggregate metrics for mock cases", async () => {
      await writeFixture("a.json", {
        prNumber: 1,
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: [{ file: "f.ts", line: 1, severity: "High" }],
        mockResponse:
          '{"summary":"s","verdict":"block","resolvedCommentIds":[],"newComments":[{"file":"f.ts","line":1,"severity":"High","confidence":"High","message":"Bug","promptForAgents":"Fix"}]}',
      });

      const result = await runEvaluation({ mode: "mock", casesDir: tmpDir });
      expect(result.mode).toBe("mock");
      expect(result.caseResults).toHaveLength(1);
      expect(result.totals.truePositives).toBe(1);
      expect(result.totals.precision).toBe(1);
      expect(result.totals.recall).toBe(1);
      expect(result.markdownReport).toContain("Jules PR Reviewer");
    });

    it("supports a custom mock review provider", async () => {
      await writeFixture("a.json", {
        prNumber: 1,
        owner: "o",
        repo: "r",
        title: "t",
        body: "b",
        diff: "d",
        expectedFindings: [],
      });

      const provider = vi.fn().mockResolvedValue({
        summary: "custom",
        verdict: "approve",
        resolvedCommentIds: [],
        newComments: [],
      });

      const result = await runEvaluation({
        mode: "mock",
        casesDir: tmpDir,
        mockReviewProvider: provider,
      });

      expect(provider).toHaveBeenCalledTimes(1);
      expect(result.caseResults[0]?.reviewResult.summary).toBe("custom");
    });

    it("handles empty cases directory", async () => {
      const result = await runEvaluation({ mode: "mock", casesDir: tmpDir });
      expect(result.caseResults).toHaveLength(0);
      expect(result.totals.truePositives).toBe(0);
      expect(result.markdownReport).toContain("No cases were loaded");
    });
  });

  describe("formatMarkdownReport", () => {
    it("includes aggregate and per-case sections", () => {
      const result = runEvaluationResultFactory({
        caseResults: [
          {
            case: {
              prNumber: 1,
              owner: "o",
              repo: "r",
              title: "t",
              body: "b",
              diff: "d",
              expectedFindings: [],
              tags: ["security"],
            },
            reviewResult: {
              summary: "s",
              verdict: "approve",
              resolvedCommentIds: [],
              newComments: [],
            },
            comparison: {
              truePositives: 0,
              falsePositives: 0,
              falseNegatives: 0,
              precision: 0,
              recall: 0,
              f1: 0,
              matchedComments: [],
              unmatchedComments: [],
              unmatchedExpected: [],
            },
          },
        ],
      });

      const report = formatMarkdownReport(result);
      expect(report).toContain("# Jules PR Reviewer");
      expect(report).toContain("Aggregate metrics");
      expect(report).toContain("Per-case results");
      expect(report).toContain("o/r#1");
      expect(report).toContain("security");
    });

    it("lists matched findings, false positives, and false negatives", () => {
      const result = runEvaluationResultFactory({
        caseResults: [
          {
            case: {
              prNumber: 2,
              owner: "o",
              repo: "r",
              title: "t",
              body: "b",
              diff: "d",
              expectedFindings: [],
            },
            reviewResult: {
              summary: "s",
              verdict: "comment",
              resolvedCommentIds: [],
              newComments: [
                makeComment({ file: "a.ts", line: 1, message: "matched" }),
                makeComment({ file: "b.ts", line: 2, message: "fp" }),
              ],
            },
            comparison: {
              truePositives: 1,
              falsePositives: 1,
              falseNegatives: 1,
              precision: 0.5,
              recall: 0.5,
              f1: 0.5,
              matchedComments: [
                makeComment({ file: "a.ts", line: 1, message: "matched" }),
              ],
              unmatchedComments: [
                makeComment({ file: "b.ts", line: 2, message: "fp" }),
              ],
              unmatchedExpected: [
                {
                  file: "c.ts",
                  line: 3,
                  severity: "High" as const,
                  message: "fn",
                },
              ],
            },
          },
        ],
      });

      const report = formatMarkdownReport(result);
      expect(report).toContain("Matched findings");
      expect(report).toContain("False positives");
      expect(report).toContain("False negatives");
      expect(report).toContain("a.ts:1");
      expect(report).toContain("b.ts:2");
      expect(report).toContain("c.ts:3");
      expect(report).toContain("fn");
    });
  });
});

function runEvaluationResultFactory(
  overrides: Partial<{
    mode: "mock" | "live";
    caseResults: {
      case: EvalCase;
      reviewResult: ReviewResult;
      comparison: ReturnType<typeof compareFindings>;
    }[];
    totals: ReturnType<typeof compareFindings>;
  }>
) {
  const caseResults = overrides.caseResults ?? [];
  const totals =
    overrides.totals ??
    ({
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 0,
      recall: 0,
      f1: 0,
      matchedComments: [],
      unmatchedComments: [],
      unmatchedExpected: [],
    } as ReturnType<typeof compareFindings>);

  return {
    mode: overrides.mode ?? "mock",
    caseResults,
    totals,
    markdownReport: "",
  };
}
