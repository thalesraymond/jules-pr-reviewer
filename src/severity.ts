import { Severity, ReviewComment, Verdict, FailOn } from "./types.js";

const SEVERITY_RANK: Record<Severity, number> = {
  Info: 0,
  Warning: 1,
  High: 2,
};

export type SeverityGate = "high" | "warning" | "info";

const SEVERITY_GATES: readonly [SeverityGate, Severity][] = [
  ["high", "High"],
  ["warning", "Warning"],
  ["info", "Info"],
];

export const VALID_SEVERITY_GATES: readonly SeverityGate[] = SEVERITY_GATES.map(
  ([gate]) => gate
);

export function parseSeverityGate(value: string): Severity | undefined {
  const gate = value.toLowerCase();
  const pair = SEVERITY_GATES.find(([g]) => g === gate);
  return pair ? pair[1] : undefined;
}

export function severityAtLeast(
  severity: Severity,
  minimum: Severity
): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[minimum];
}

export function filterCommentsBySeverity(
  comments: ReviewComment[],
  minimum: Severity
): ReviewComment[] {
  return comments.filter((c) => severityAtLeast(c.severity, minimum));
}

export function hasFindingsAtOrAbove(
  comments: ReviewComment[],
  severity: Severity
): boolean {
  return comments.some((c) => severityAtLeast(c.severity, severity));
}

export function conclusionFromVerdict(
  verdict: Verdict,
  failOn: FailOn
): { conclusion: "success" | "failure"; description: string } {
  if (!["approve", "comment", "block"].includes(verdict)) {
    return {
      conclusion: "failure",
      description: "Invalid review verdict",
    };
  }

  if (failOn === "never") {
    return {
      conclusion: "success",
      description: `Review complete (verdict: ${verdict})`,
    };
  }
  if (failOn === "any") {
    return verdict === "approve"
      ? { conclusion: "success", description: "Approved" }
      : { conclusion: "failure", description: `Review verdict: ${verdict}` };
  }
  return verdict === "block"
    ? { conclusion: "failure", description: "Blocking issues found" }
    : {
        conclusion: "success",
        description: `Review complete (verdict: ${verdict})`,
      };
}

export function conclusionFromFindings(
  comments: ReviewComment[],
  blockOn: Severity
): { conclusion: "success" | "failure"; description: string } {
  return hasFindingsAtOrAbove(comments, blockOn)
    ? {
        conclusion: "failure",
        description: `Findings at or above ${blockOn.toLowerCase()} severity found`,
      }
    : {
        conclusion: "success",
        description: `No findings at or above ${blockOn.toLowerCase()} severity`,
      };
}
