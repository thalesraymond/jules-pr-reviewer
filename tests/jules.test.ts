import { describe, it, expect } from "vitest";
import { wrapPermissionError } from "../src/jules.js";

describe("wrapPermissionError", () => {
  it("wraps 403 errors with helpful instructions", () => {
    const result = wrapPermissionError(
      new Error("Request failed with status 403"),
      "checks:write",
      "createCheckRun"
    );
    expect(result.message).toContain("createCheckRun failed with 403");
    expect(result.message).toContain("permissions:");
    expect(result.message).toContain("checks: write");
  });

  it("wraps inaccessible-resource errors with helpful instructions", () => {
    const result = wrapPermissionError(
      new Error("Resource not accessible by integration"),
      "checks:write",
      "createCheckRun"
    );
    expect(result.message).toContain("createCheckRun failed with 403");
    expect(result.message).toContain("checks: write");
  });

  it("passes through other Error instances unchanged", () => {
    const err = new Error("Some other error");
    expect(wrapPermissionError(err, "checks:write", "createCheckRun")).toBe(
      err
    );
  });

  it("wraps non-Error values", () => {
    const result = wrapPermissionError(
      "Just a string error",
      "checks:write",
      "createCheckRun"
    );
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("Just a string error");
  });
});
