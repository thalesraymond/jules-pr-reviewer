import { promises as fs } from "node:fs";
import path from "node:path";
import { ReviewComment, ReviewResult, Severity } from "./types.js";
import { parseReviewResponse } from "./validation.js";

export type EvalMode = "mock" | "live";

export interface ExpectedFinding {
  file: string;
  line: number;
  severity: Severity;
  message?: string;
}

export interface EvalCase {
  prNumber: number;
  owner: string;
  repo: string;
  title: string;
  body: string;
  diff: string;
  expectedFindings: ExpectedFinding[];
  /** Raw Jules-style JSON response used by the deterministic mock runner. */
  mockResponse?: string;
  tags?: string[];
}

export interface ComparisonResult {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  matchedComments: ReviewComment[];
  unmatchedComments: ReviewComment[];
  unmatchedExpected: ExpectedFinding[];
}

export interface CaseResult {
  case: EvalCase;
  reviewResult: ReviewResult;
  comparison: ComparisonResult;
}

export interface EvalRunResult {
  mode: EvalMode;
  caseResults: CaseResult[];
  totals: ComparisonResult;
  markdownReport: string;
}

export interface RunEvaluationOptions {
  mode: EvalMode;
  casesDir: string;
  /** Override how a mock review is produced for a fixture. */
  mockReviewProvider?: (
    evalCase: EvalCase
  ) => ReviewResult | Promise<ReviewResult>;
}

type MutableExpectedFinding = ExpectedFinding & { matched: boolean };

export async function loadCases(casesDir: string): Promise<EvalCase[]> {
  const entries = await fs.readdir(casesDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort();

  const cases: EvalCase[] = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(casesDir, file), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    cases.push(validateEvalCase(parsed, file));
  }

  return cases;
}

function requireString(
  raw: Record<string, unknown>,
  key: string,
  fileName: string
): string {
  if (typeof raw[key] !== "string") {
    throw new Error(`Fixture ${fileName} is missing required field: ${key}`);
  }
  return raw[key] as string;
}

function validateEvalCase(parsed: unknown, fileName: string): EvalCase {
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Fixture ${fileName} is not a JSON object`);
  }

  const raw = parsed as Record<string, unknown>;

  if (typeof raw.prNumber !== "number") {
    throw new Error(`Fixture ${fileName} is missing required field: prNumber`);
  }

  const owner = requireString(raw, "owner", fileName);
  const repo = requireString(raw, "repo", fileName);
  const title = requireString(raw, "title", fileName);
  const body = requireString(raw, "body", fileName);
  const diff = requireString(raw, "diff", fileName);

  if (!Array.isArray(raw.expectedFindings)) {
    throw new Error(
      `Fixture ${fileName} is missing required field: expectedFindings`
    );
  }

  return {
    prNumber: raw.prNumber,
    owner,
    repo,
    title,
    body,
    diff,
    expectedFindings: raw.expectedFindings.map((f) =>
      validateExpectedFinding(f, fileName)
    ),
    mockResponse:
      typeof raw.mockResponse === "string" ? raw.mockResponse : undefined,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string")
      : undefined,
  };
}

function validateExpectedFinding(
  finding: unknown,
  fileName: string
): ExpectedFinding {
  if (!finding || typeof finding !== "object") {
    throw new Error(
      `Fixture ${fileName} contains a non-object expected finding`
    );
  }

  const raw = finding as Record<string, unknown>;
  if (typeof raw.file !== "string") {
    throw new Error(`Fixture ${fileName} expected finding missing file`);
  }
  if (typeof raw.line !== "number") {
    throw new Error(`Fixture ${fileName} expected finding missing line`);
  }
  if (
    raw.severity !== "High" &&
    raw.severity !== "Warning" &&
    raw.severity !== "Info"
  ) {
    throw new Error(
      `Fixture ${fileName} expected finding has invalid severity`
    );
  }

  return {
    file: raw.file,
    line: raw.line,
    severity: raw.severity,
    message: typeof raw.message === "string" ? raw.message : undefined,
  };
}

export function compareFindings(
  actual: ReviewComment[],
  expected: ExpectedFinding[]
): ComparisonResult {
  const matchedComments: ReviewComment[] = [];
  const unmatchedComments: ReviewComment[] = [];
  const unmatchedExpected: ExpectedFinding[] = [];

  const expectedRemaining: MutableExpectedFinding[] = expected.map((e) => ({
    ...e,
    matched: false,
  }));

  for (const comment of actual) {
    const matchIndex = expectedRemaining.findIndex(
      (e) =>
        !e.matched &&
        e.file === comment.file &&
        e.line === comment.line &&
        e.severity === comment.severity &&
        (!e.message || comment.message.includes(e.message))
    );

    if (matchIndex !== -1) {
      expectedRemaining[matchIndex].matched = true;
      matchedComments.push(comment);
    } else {
      unmatchedComments.push(comment);
    }
  }

  for (const e of expectedRemaining) {
    if (!e.matched) {
      unmatchedExpected.push({
        file: e.file,
        line: e.line,
        severity: e.severity,
        message: e.message,
      });
    }
  }

  const truePositives = matchedComments.length;
  const falsePositives = unmatchedComments.length;
  const falseNegatives = unmatchedExpected.length;

  return {
    ...computeMetrics(truePositives, falsePositives, falseNegatives),
    matchedComments,
    unmatchedComments,
    unmatchedExpected,
  };
}

function computeMetrics(
  truePositives: number,
  falsePositives: number,
  falseNegatives: number
): Omit<
  ComparisonResult,
  "matchedComments" | "unmatchedComments" | "unmatchedExpected"
> {
  const precision =
    truePositives + falsePositives === 0
      ? 0
      : truePositives / (truePositives + falsePositives);
  const recall =
    truePositives + falseNegatives === 0
      ? 0
      : truePositives / (truePositives + falseNegatives);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
  };
}

export function scoreReview(
  evalCase: EvalCase,
  reviewResult: ReviewResult
): ComparisonResult {
  return compareFindings(reviewResult.newComments, evalCase.expectedFindings);
}

export async function defaultMockReview(
  evalCase: EvalCase
): Promise<ReviewResult> {
  if (!evalCase.mockResponse) {
    return {
      summary: "No mock response configured.",
      verdict: "approve",
      resolvedCommentIds: [],
      newComments: [],
    };
  }

  return parseReviewResponse(evalCase.mockResponse);
}

export async function runEvaluation(
  options: RunEvaluationOptions
): Promise<EvalRunResult> {
  if (options.mode === "live") {
    throw new Error(
      "Live evaluation requires explicit opt-in and a valid JULES_API_KEY. " +
        "It creates real, budgeted Jules sessions. Set mode to 'mock' for CI."
    );
  }

  const cases = await loadCases(options.casesDir);
  const provider = options.mockReviewProvider ?? defaultMockReview;
  const caseResults: CaseResult[] = [];

  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;

  for (const evalCase of cases) {
    const reviewResult = await provider(evalCase);
    const comparison = scoreReview(evalCase, reviewResult);
    caseResults.push({ case: evalCase, reviewResult, comparison });
    totalTp += comparison.truePositives;
    totalFp += comparison.falsePositives;
    totalFn += comparison.falseNegatives;
  }

  const result: EvalRunResult = {
    mode: options.mode,
    caseResults,
    totals: {
      ...computeMetrics(totalTp, totalFp, totalFn),
      matchedComments: [],
      unmatchedComments: [],
      unmatchedExpected: [],
    },
    markdownReport: "",
  };

  result.markdownReport = formatMarkdownReport(result);
  return result;
}

export function formatMarkdownReport(result: EvalRunResult): string {
  const lines: string[] = [];

  lines.push("# Jules PR Reviewer — Quality Evaluation Report");
  lines.push("");
  lines.push(`**Mode:** \`${result.mode}\``);
  lines.push(`**Cases evaluated:** ${result.caseResults.length}`);
  lines.push("");

  lines.push("## Aggregate metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | --- |");
  lines.push(metricRow("True positives", result.totals.truePositives));
  lines.push(metricRow("False positives", result.totals.falsePositives));
  lines.push(metricRow("False negatives", result.totals.falseNegatives));
  lines.push(metricRow("Precision", formatPercent(result.totals.precision)));
  lines.push(metricRow("Recall", formatPercent(result.totals.recall)));
  lines.push(metricRow("F1 score", formatPercent(result.totals.f1)));
  lines.push("");

  lines.push("## Per-case results");
  lines.push("");

  if (result.caseResults.length === 0) {
    lines.push("_No cases were loaded._");
    lines.push("");
  }

  for (const cr of result.caseResults) {
    const c = cr.case;
    const repo = `${c.owner}/${c.repo}`;
    const tags = c.tags?.length ? ` (${c.tags.join(", ")})` : "";

    lines.push(`### ${repo}#${c.prNumber}${tags}`);
    lines.push("");
    lines.push(`**Title:** ${c.title}`);
    lines.push(
      `**Scores:** precision ${formatPercent(
        cr.comparison.precision
      )}, recall ${formatPercent(cr.comparison.recall)}, F1 ${formatPercent(
        cr.comparison.f1
      )}`
    );
    lines.push("");

    if (cr.comparison.matchedComments.length > 0) {
      lines.push("#### Matched findings");
      lines.push("");
      for (const comment of cr.comparison.matchedComments) {
        lines.push(
          `- \`${comment.file}:${comment.line}\` **${comment.severity}** — ${comment.message}`
        );
      }
      lines.push("");
    }

    if (cr.comparison.unmatchedComments.length > 0) {
      lines.push("#### False positives");
      lines.push("");
      for (const comment of cr.comparison.unmatchedComments) {
        lines.push(
          `- \`${comment.file}:${comment.line}\` **${comment.severity}** — ${comment.message}`
        );
      }
      lines.push("");
    }

    if (cr.comparison.unmatchedExpected.length > 0) {
      lines.push("#### False negatives (missed expected findings)");
      lines.push("");
      for (const expected of cr.comparison.unmatchedExpected) {
        const msg = expected.message
          ? ` — must include "${expected.message}"`
          : "";
        lines.push(
          `- \`${expected.file}:${expected.line}\` **${expected.severity}**${msg}`
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function metricRow(label: string, value: string | number): string {
  return `| ${label} | ${value} |`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
