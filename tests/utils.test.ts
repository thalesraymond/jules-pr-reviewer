import { describe, it, expect, vi } from "vitest";
import {
  withFallback,
  withRetry,
  parseIgnoredPaths,
  shouldIgnorePath,
  filterDiff,
  RetryOptions,
} from "../src/utils.js";

describe("withRetry", () => {
  it("should return the result immediately if the operation succeeds", async () => {
    const operation = vi.fn().mockResolvedValue("success");
    const options: RetryOptions = {
      maxRetries: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
    };

    const result = await withRetry(operation, options);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should retry and succeed on a subsequent attempt", async () => {
    const error = new Error("temporary error");
    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("success");
    const options: RetryOptions = {
      maxRetries: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
    };

    const result = await withRetry(operation, options);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("should exhaust retries and throw the final error", async () => {
    const error = new Error("persistent error");
    const operation = vi.fn().mockRejectedValue(error);
    const options: RetryOptions = {
      maxRetries: 2,
      initialDelayMs: 10,
      maxDelayMs: 100,
    };

    await expect(withRetry(operation, options)).rejects.toThrow(
      "persistent error"
    );

    expect(operation).toHaveBeenCalledTimes(3); // Initial attempt + 2 retries
  });

  it("should not retry if shouldRetry returns false", async () => {
    const error = new Error("fatal error");
    const operation = vi.fn().mockRejectedValue(error);
    const shouldRetry = vi.fn().mockReturnValue(false);
    const options: RetryOptions = {
      maxRetries: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
      shouldRetry,
    };

    await expect(withRetry(operation, options)).rejects.toThrow("fatal error");

    expect(operation).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith(error);
  });

  it("should retry only if shouldRetry returns true", async () => {
    const error1 = new Error("temporary error");
    const error2 = new Error("fatal error");
    const operation = vi
      .fn()
      .mockRejectedValueOnce(error1)
      .mockRejectedValueOnce(error2);
    const shouldRetry = vi.fn((err: unknown) => {
      return (err as Error).message === "temporary error";
    });
    const options: RetryOptions = {
      maxRetries: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
      shouldRetry,
    };

    await expect(withRetry(operation, options)).rejects.toThrow("fatal error");

    expect(operation).toHaveBeenCalledTimes(2);
    expect(shouldRetry).toHaveBeenCalledTimes(2);
  });
});

describe("withFallback", () => {
  it("should return the result of the primary function if it succeeds", async () => {
    const primary = vi.fn().mockResolvedValue("primary result");
    const fallback = vi.fn().mockResolvedValue("fallback result");
    const shouldFallback = vi.fn().mockReturnValue(true);

    const result = await withFallback(primary, fallback, shouldFallback);

    expect(result).toBe("primary result");
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(shouldFallback).not.toHaveBeenCalled();
  });

  it("should execute and return the fallback function if the primary throws an error that matches shouldFallback", async () => {
    const error = new Error("primary error");
    const primary = vi.fn().mockRejectedValue(error);
    const fallback = vi.fn().mockResolvedValue("fallback result");
    const shouldFallback = vi.fn().mockReturnValue(true);

    const result = await withFallback(primary, fallback, shouldFallback);

    expect(result).toBe("fallback result");
    expect(primary).toHaveBeenCalledTimes(1);
    expect(shouldFallback).toHaveBeenCalledWith(error);
    expect(shouldFallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith(error);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("should re-throw the original error if shouldFallback returns false", async () => {
    const error = new Error("primary error");
    const primary = vi.fn().mockRejectedValue(error);
    const fallback = vi.fn().mockResolvedValue("fallback result");
    const shouldFallback = vi.fn().mockReturnValue(false);

    await expect(
      withFallback(primary, fallback, shouldFallback)
    ).rejects.toThrow("primary error");

    expect(primary).toHaveBeenCalledTimes(1);
    expect(shouldFallback).toHaveBeenCalledWith(error);
    expect(shouldFallback).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("should re-throw the error if the fallback function itself throws", async () => {
    const primaryError = new Error("primary error");
    const fallbackError = new Error("fallback error");
    const primary = vi.fn().mockRejectedValue(primaryError);
    const fallback = vi.fn().mockRejectedValue(fallbackError);
    const shouldFallback = vi.fn().mockReturnValue(true);

    await expect(
      withFallback(primary, fallback, shouldFallback)
    ).rejects.toThrow("fallback error");

    expect(primary).toHaveBeenCalledTimes(1);
    expect(shouldFallback).toHaveBeenCalledWith(primaryError);
    expect(fallback).toHaveBeenCalledWith(primaryError);
  });
});

describe("parseIgnoredPaths", () => {
  it("returns empty array for empty or undefined input", () => {
    expect(parseIgnoredPaths()).toEqual([]);
    expect(parseIgnoredPaths("")).toEqual([]);
    expect(parseIgnoredPaths("   ")).toEqual([]);
  });

  it("parses valid JSON array strings", () => {
    expect(parseIgnoredPaths('["dist/**", "*.lock"]')).toEqual([
      "dist/**",
      "*.lock",
    ]);
  });

  it("filters out non-string items or empty strings in JSON array", () => {
    expect(
      parseIgnoredPaths('["dist/**", 123, "", null, "  *.lock "]')
    ).toEqual(["dist/**", "*.lock"]);
  });

  it("falls back to comma or newline separated values if not valid JSON", () => {
    expect(parseIgnoredPaths("dist/**, *.lock\nbuild/*")).toEqual([
      "dist/**",
      "*.lock",
      "build/*",
    ]);
  });
});

describe("shouldIgnorePath", () => {
  it("returns false if ignoredPatterns is empty", () => {
    expect(shouldIgnorePath("dist/index.js", [])).toBe(false);
  });

  it("matches exact paths and glob patterns", () => {
    const patterns = ["dist/**", "*.lock", "config/secret.json"];
    expect(shouldIgnorePath("dist/index.js", patterns)).toBe(true);
    expect(shouldIgnorePath("yarn.lock", patterns)).toBe(true);
    expect(shouldIgnorePath("config/secret.json", patterns)).toBe(true);
    expect(shouldIgnorePath("src/index.ts", patterns)).toBe(false);
  });

  it("matches folder prefix when pattern has trailing slash or folder name", () => {
    expect(shouldIgnorePath("dist/index.js", ["dist/"])).toBe(true);
    expect(shouldIgnorePath("dist/index.js", ["dist"])).toBe(true);
  });
});

describe("filterDiff", () => {
  const sampleDiff = `diff --git a/src/index.ts b/src/index.ts
index 1234567..89abcdef 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import * as core from "@actions/core";

diff --git a/dist/index.js b/dist/index.js
index abcdef1..2345678 100644
--- a/dist/index.js
+++ b/dist/index.js
@@ -1,5 +1,5 @@
 module.exports = ...
diff --git a/package-lock.json b/package-lock.json
index 1111111..2222222 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,5 +1,5 @@
 {}`;

  it("returns original diff if ignoredPatterns is empty", () => {
    expect(filterDiff(sampleDiff, [])).toBe(sampleDiff);
  });

  it("filters out matching file blocks from diff", () => {
    const filtered = filterDiff(sampleDiff, ["dist/**", "*.json"]);
    expect(filtered).toContain("src/index.ts");
    expect(filtered).not.toContain("dist/index.js");
    expect(filtered).not.toContain("package-lock.json");
  });

  it("returns empty string if all diff blocks are filtered out", () => {
    const filtered = filterDiff(sampleDiff, ["**/*"]);
    expect(filtered).toBe("");
  });
});
