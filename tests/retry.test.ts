import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry } from "../src/retry.js";

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should return the result immediately if the operation succeeds on the first try", async () => {
    const operation = vi.fn().mockResolvedValue("success");

    const result = await withRetry(operation);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should retry the operation if it fails and eventually succeed", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failure 1"))
      .mockRejectedValueOnce(new Error("Failure 2"))
      .mockResolvedValue("success");

    const promise = withRetry(operation, {
      maxRetries: 3,
      initialDelayMs: 1000,
    });

    // Advance time to allow retries to execute
    // Wait for the microtask queue to process the failure before advancing
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000); // After first failure
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2000); // After second failure

    const result = await promise;

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("should throw the error if maxRetries is reached", async () => {
    const error = new Error("Permanent Failure");
    const operation = vi.fn().mockRejectedValue(error);

    let caughtError: Error | undefined;
    const promise = withRetry(operation, {
      maxRetries: 2,
      initialDelayMs: 1000,
    }).catch((e) => {
      caughtError = e;
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000); // After first failure
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2000); // After second failure
    await promise;

    expect(caughtError).toBe(error);
    expect(operation).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("should not retry if shouldRetry returns false", async () => {
    const error = new Error("Abort");
    const operation = vi.fn().mockRejectedValue(error);
    const shouldRetry = vi.fn().mockReturnValue(false);

    let caughtError: Error | undefined;
    await withRetry(operation, { shouldRetry }).catch((e) => {
      caughtError = e;
    });

    expect(caughtError).toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith(error);
  });

  it("should respect maxDelayMs and backoffFactor", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("Fail"));

    // Create a mock for setTimeout to track delays
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    let caughtError: Error | undefined;
    const promise = withRetry(operation, {
      maxRetries: 3,
      initialDelayMs: 1000,
      backoffFactor: 3,
      maxDelayMs: 5000,
    }).catch((e) => {
      caughtError = e;
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000); // First delay: 1000
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3000); // Second delay: 1000 * 3 = 3000
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000); // Third delay: min(3000 * 3, 5000) = 5000
    await promise;

    expect(caughtError?.message).toBe("Fail");

    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
    // setTimeout might be called with internal timers args, but the delay should be the 2nd arg
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(1000);
    expect(setTimeoutSpy.mock.calls[1][1]).toBe(3000);
    expect(setTimeoutSpy.mock.calls[2][1]).toBe(5000);
  });

  it("should handle default options and invalid options gracefully", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("Fail"));

    let caughtError: Error | undefined;
    await withRetry(operation, {
      maxRetries: -1, // Should default to 0
      initialDelayMs: -100, // Should default to 0
      maxDelayMs: -50, // Should default to 0
      backoffFactor: -5, // Should default to 1
    }).catch((e) => {
      caughtError = e;
    });

    expect(caughtError?.message).toBe("Fail");
    expect(operation).toHaveBeenCalledTimes(1); // 1 initial + 0 retries
  });
});
