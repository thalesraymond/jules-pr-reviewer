import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/utils/retry.js";

describe("withRetry", () => {
  it("should return successfully on the first attempt", async () => {
    const operation = vi.fn().mockResolvedValue("success");
    const result = await withRetry(operation);
    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should retry and succeed after failures", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const result = await withRetry(operation, { baseDelay: 10 });
    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("should throw after reaching max attempts", async () => {
    const error = new Error("permanent fail");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(operation, { maxAttempts: 3, baseDelay: 10 })
    ).rejects.toThrow("permanent fail");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("should abort early if shouldRetry returns false", async () => {
    const error = new Error("abort");
    const operation = vi.fn().mockRejectedValue(error);
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(
      withRetry(operation, { maxAttempts: 5, baseDelay: 10, shouldRetry })
    ).rejects.toThrow("abort");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith(error);
  });

  it("should wait exponentially between retries", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const start = Date.now();
    await withRetry(operation, { baseDelay: 50 });
    const end = Date.now();

    // Attempt 1 fails immediately
    // Wait for attempt 2: 50 * 2^0 = 50ms
    // Attempt 2 fails immediately
    // Wait for attempt 3: 50 * 2^1 = 100ms
    // Attempt 3 succeeds
    // Total wait time ~150ms
    expect(end - start).toBeGreaterThanOrEqual(140);
  });
});
