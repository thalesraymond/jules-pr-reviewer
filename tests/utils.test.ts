import { describe, it, expect, vi } from "vitest";
import { withFallback, withRetry } from "../src/utils.js";

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

describe("withRetry", () => {
  it("should return the result immediately if the operation succeeds", async () => {
    const operation = vi.fn().mockResolvedValue("success");
    const shouldRetry = vi.fn().mockReturnValue(true);

    const result = await withRetry(operation, 3, 10, 100, shouldRetry);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(shouldRetry).not.toHaveBeenCalled();
  });

  it("should retry and succeed if the operation fails initially but succeeds later", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockResolvedValueOnce("success");
    const shouldRetry = vi.fn().mockReturnValue(true);

    const result = await withRetry(operation, 3, 10, 100, shouldRetry);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });

  it("should throw the error after max attempts are exhausted", async () => {
    const error = new Error("permanent fail");
    const operation = vi.fn().mockRejectedValue(error);
    const shouldRetry = vi.fn().mockReturnValue(true);

    await expect(withRetry(operation, 3, 10, 100, shouldRetry)).rejects.toThrow(
      "permanent fail"
    );

    expect(operation).toHaveBeenCalledTimes(3);
    expect(shouldRetry).toHaveBeenCalledTimes(2); // checked after attempt 1 and 2, but not after 3 because max attempts reached
  });

  it("should throw the error immediately if shouldRetry returns false", async () => {
    const error = new Error("fatal error");
    const operation = vi.fn().mockRejectedValue(error);
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(withRetry(operation, 3, 10, 100, shouldRetry)).rejects.toThrow(
      "fatal error"
    );

    expect(operation).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });
});
