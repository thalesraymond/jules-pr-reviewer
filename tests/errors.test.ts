import { describe, it, expect } from "vitest";
import {
  getErrorMessage,
  classifyFailure,
  isQuotaError,
  isAuthError,
  QuotaExceededError,
  AuthError,
  timeoutExitSummary,
} from "../src/errors.js";

describe("getErrorMessage", () => {
  it("should extract message from an Error instance", () => {
    const error = new Error("This is an error");
    expect(getErrorMessage(error)).toBe("This is an error");
  });

  it("should extract message from an object with a message property", () => {
    const error = { message: "Custom object error" };
    expect(getErrorMessage(error)).toBe("Custom object error");
  });

  it("should convert a plain string to a string", () => {
    const error = "String error";
    expect(getErrorMessage(error)).toBe("String error");
  });

  it("should handle null and undefined", () => {
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("should handle other primitives", () => {
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage(true)).toBe("true");
  });
});

describe("isQuotaError", () => {
  it("returns true for 429 status codes", () => {
    expect(isQuotaError("Request failed with status code 429")).toBe(true);
  });

  it("returns true for quota / rate-limit wording", () => {
    expect(isQuotaError("quota exceeded")).toBe(true);
    expect(isQuotaError("rate limit reached")).toBe(true);
    expect(isQuotaError("session cap reached")).toBe(true);
  });

  it("returns false for auth and unrelated messages", () => {
    expect(isQuotaError("status code 401")).toBe(false);
    expect(isQuotaError("boom")).toBe(false);
  });
});

describe("isAuthError", () => {
  it("returns true for 401 and 403", () => {
    expect(isAuthError("status code 401")).toBe(true);
    expect(isAuthError("status 403 forbidden")).toBe(true);
  });

  it("returns true for Resource not accessible wording", () => {
    expect(isAuthError("Resource not accessible by integration")).toBe(true);
  });

  it("returns false for other status codes", () => {
    expect(isAuthError("status 404 not found")).toBe(false);
    expect(isAuthError("status 500 server error")).toBe(false);
  });
});

describe("QuotaExceededError and AuthError", () => {
  it("carry their failure kind", () => {
    const quota = new QuotaExceededError("q", { cause: new Error("root") });
    expect(quota.kind).toBe("quota");
    expect(quota.name).toBe("QuotaExceededError");
    expect(quota.message).toBe("q");
    expect(quota.cause).toBeInstanceOf(Error);

    const auth = new AuthError("a");
    expect(auth.kind).toBe("auth");
    expect(auth.name).toBe("AuthError");
    expect(auth.message).toBe("a");
  });
});

describe("classifyFailure", () => {
  it("classifies quota via the error class and reuses its actionable message", () => {
    const failure = classifyFailure(
      new QuotaExceededError(
        "Jules API quota or rate limit exceeded (status 429). The free tier allows 15 sessions per 24 hours — wait for the window to reset or reduce usage.",
        { cause: new Error("root") }
      )
    );
    expect(failure.kind).toBe("quota");
    expect(failure.stage).toBe("quota");
    expect(failure.message).toContain("429");
    expect(failure.summary).toBe(failure.message);
    expect(failure.summary).toContain("15 sessions per 24 hours");
  });

  it("classifies quota from a raw 429 message", () => {
    const failure = classifyFailure(new Error("status code 429"));
    expect(failure.kind).toBe("quota");
    expect(failure.stage).toBe("quota");
    expect(failure.summary).toContain("rate limit");
  });

  it("classifies a GitHub rate-limit message as quota with a GitHub-specific summary", () => {
    const failure = classifyFailure(
      new Error("You have exceeded a secondary rate limit. status 403")
    );
    expect(failure.kind).toBe("quota");
    expect(failure.summary).toContain("GitHub API rate limit exceeded");
    expect(failure.summary).not.toContain("JULES_API_KEY");
    expect(failure.summary).not.toContain("15 sessions");
  });

  it("classifies auth via the error class and reuses its actionable message", () => {
    const failure = classifyFailure(
      new AuthError(
        "Jules API rejected request (status 401). Check JULES_API_KEY is valid."
      )
    );
    expect(failure.kind).toBe("auth");
    expect(failure.stage).toBe("auth");
    expect(failure.summary).toBe(failure.message);
    expect(failure.summary).toContain("JULES_API_KEY");
  });

  it("classifies auth from a raw 401 message", () => {
    const failure = classifyFailure(new Error("status code 401"));
    expect(failure.kind).toBe("auth");
    expect(failure.summary).toContain("authentication or permissions error");
  });

  it("classifies permission wording as auth", () => {
    const failure = classifyFailure(
      new Error(
        "createCheckRun failed with 403. The github_token likely lacks checks:write."
      )
    );
    expect(failure.kind).toBe("auth");
  });

  it("classifies config messages as config", () => {
    const failure = classifyFailure(new Error('Invalid fail_on: "bogus"'));
    expect(failure.kind).toBe("config");
    expect(failure.stage).toBe("config");
    expect(failure.summary).toContain("Configuration error");
  });

  it("classifies parse wording as parse", () => {
    const failure = classifyFailure(
      new Error("Failed to parse Jules response as JSON")
    );
    expect(failure.kind).toBe("parse");
    expect(failure.stage).toBe("parse");
    expect(failure.summary).toContain("could not be parsed");
  });

  it("classifies timeout wording as timeout", () => {
    const failure = classifyFailure(new Error("Jules session timed out"));
    expect(failure.kind).toBe("timeout");
    expect(failure.stage).toBe("timeout");
    expect(failure.summary).toContain("timeout_minutes");
  });

  it("classifies unknown errors with review_execution stage", () => {
    const failure = classifyFailure(new Error("Network error"));
    expect(failure.kind).toBe("unknown");
    expect(failure.stage).toBe("review_execution");
    expect(failure.message).toBe("Network error");
    expect(failure.summary).toContain("Network error");
    expect(failure.summary).toContain("Check GitHub Actions log");
  });

  it("handles non-Error thrown values", () => {
    const failure = classifyFailure("just a string");
    expect(failure.kind).toBe("unknown");
    expect(failure.message).toBe("just a string");
  });
});

describe("timeoutExitSummary", () => {
  it("names the timeout budget and suggests a fix", () => {
    expect(timeoutExitSummary(30)).toBe(
      "Jules did not return a valid review within 30 minutes. Try increasing timeout_minutes or re-run the workflow."
    );
  });
});
