import { Severity, ReviewComment } from "./types.js";

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
