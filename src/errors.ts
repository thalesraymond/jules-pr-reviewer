export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error !== null && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

/**
 * Failure taxonomy for the action. Every failure path maps to one of these
 * kinds so the check run and the structured log describe the root cause
 * instead of a generic error.
 */
export type FailureKind =
  "config" | "auth" | "quota" | "parse" | "timeout" | "unknown";

export interface ReviewFailure {
  kind: FailureKind;
  /** Structured-log stage (e.g. "config", "quota", "review_execution"). */
  stage: string;
  /** Root cause, for logging and core.setFailed. */
  message: string;
  /** Actionable summary written to the `jules/review` check run output. */
  summary: string;
}

export class QuotaExceededError extends Error {
  readonly kind = "quota" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "QuotaExceededError";
  }
}

export class AuthError extends Error {
  readonly kind = "auth" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthError";
  }
}

const CONFIG_PATTERN =
  /(?:invalid fail_on|invalid diff_mode|invalid large_pr_strategy|missing input)/i;
/** Jules SDK quota exhaustion (HTTP 429, quota/cap wording). */
const JULES_QUOTA_PATTERN = /(?:429|\bquota\b|\bsession cap\b)/i;
/** GitHub API rate-limit responses (403 with rate-limit wording). */
const GITHUB_RATE_LIMIT_PATTERN =
  /(?:rate limit|secondary rate limit|abuse detection)/i;
const AUTH_PATTERN = /(?:401|403|\bnot accessible\b)/i;
const PARSE_PATTERN =
  /(?:could not be parsed|failed to parse|unparseable|invalid review response)/i;
const TIMEOUT_PATTERN =
  /(?:timed out|did not respond|no review message|become ready within timeout)/i;

/** Single copy of the free-tier quota guidance, shared across error wrappers. */
export const QUOTA_HINT =
  "The free tier allows 15 sessions per 24 hours — wait for the window to reset or reduce usage.";

export function isQuotaError(message: string): boolean {
  return /(?:429|\bquota\b|\brate limit\b|\bsession cap\b)/i.test(message);
}

export function isAuthError(message: string): boolean {
  return AUTH_PATTERN.test(message);
}

function quotaSummary(message: string): string {
  if (
    GITHUB_RATE_LIMIT_PATTERN.test(message) &&
    !JULES_QUOTA_PATTERN.test(message)
  ) {
    return `GitHub API rate limit exceeded (${message}). Wait for the rate-limit window to reset or reduce API usage.`;
  }
  return `Jules review failed: API quota or rate limit exceeded (429 / session cap). ${QUOTA_HINT} Root cause: ${message}`;
}

function authSummary(message: string): string {
  return (
    "Jules review failed: authentication or permissions error. " +
    "Check that JULES_API_KEY and GITHUB_TOKEN are valid and the workflow " +
    `grants the required permissions. Root cause: ${message}`
  );
}

function parseSummary(message: string): string {
  return `Jules returned a response that could not be parsed as a review. Root cause: ${message}`;
}

function configSummary(message: string): string {
  return `Configuration error: ${message}`;
}

function timeoutSummary(message: string): string {
  return (
    "Jules review timed out. The review did not complete within the " +
    "configured timeout_minutes; try increasing timeout_minutes or " +
    `re-running the workflow. Root cause: ${message}`
  );
}

function unknownSummary(message: string): string {
  return `Review failed: ${message}. Check GitHub Actions log for details.`;
}

/** Stage and actionable summary for each failure kind. */
const FAILURE_SPEC: Record<
  FailureKind,
  { stage: string; summary: (message: string) => string }
> = {
  config: { stage: "config", summary: configSummary },
  auth: { stage: "auth", summary: authSummary },
  quota: { stage: "quota", summary: quotaSummary },
  parse: { stage: "parse", summary: parseSummary },
  timeout: { stage: "timeout", summary: timeoutSummary },
  unknown: { stage: "review_execution", summary: unknownSummary },
};

export function classifyFailure(error: unknown): ReviewFailure {
  const message = getErrorMessage(error);

  let kind: FailureKind;
  if (
    error instanceof QuotaExceededError ||
    JULES_QUOTA_PATTERN.test(message)
  ) {
    kind = "quota";
  } else if (GITHUB_RATE_LIMIT_PATTERN.test(message)) {
    kind = "quota";
  } else if (error instanceof AuthError || AUTH_PATTERN.test(message)) {
    kind = "auth";
  } else if (CONFIG_PATTERN.test(message)) {
    kind = "config";
  } else if (PARSE_PATTERN.test(message)) {
    kind = "parse";
  } else if (TIMEOUT_PATTERN.test(message)) {
    kind = "timeout";
  } else {
    kind = "unknown";
  }

  const spec = FAILURE_SPEC[kind];
  const summary =
    error instanceof QuotaExceededError || error instanceof AuthError
      ? message
      : spec.summary(message);

  return { kind, stage: spec.stage, message, summary };
}

/** Summary for the "no review within timeout" exit, shared with index.ts. */
export function timeoutExitSummary(timeoutMinutes: number): string {
  return `Jules did not return a valid review within ${timeoutMinutes} minutes. Try increasing timeout_minutes or re-run the workflow.`;
}
