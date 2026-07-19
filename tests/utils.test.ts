import { describe, it, expect, vi } from "vitest";
import { withFallback, withRetry, RetryOptions } from "../src/utils.js";

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
