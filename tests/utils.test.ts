import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sleep, mapConcurrent } from "../src/utils.js";

describe("sleep utility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve after the specified positive delay", async () => {
    let resolved = false;
    const promise = sleep(100).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    vi.advanceTimersByTime(50);
    // await a microtask to allow promises to settle
    await Promise.resolve();
    expect(resolved).toBe(false);

    vi.advanceTimersByTime(50);
    await promise;
    expect(resolved).toBe(true);
  });

  it("should resolve immediately when delay is 0", async () => {
    let resolved = false;
    const promise = sleep(0).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    vi.advanceTimersByTime(0);
    await promise;
    expect(resolved).toBe(true);
  });

  it("should reject when delay is negative", async () => {
    await expect(sleep(-1)).rejects.toThrow(
      "sleep delay must be a non-negative number"
    );
  });
});

describe("mapConcurrent utility", () => {
  it("should map items concurrently with a given limit", async () => {
    const items = [1, 2, 3, 4, 5];
    let currentActive = 0;
    let maxActive = 0;
    const mapper = async (item: number) => {
      currentActive++;
      maxActive = Math.max(maxActive, currentActive);
      await new Promise((resolve) => setTimeout(resolve, 10));
      currentActive--;
      return item * 2;
    };
    const results = await mapConcurrent(items, 2, mapper);
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
  it("should preserve the original order of items", async () => {
    const items = [5, 1, 4, 2, 3];
    const mapper = async (item: number) => {
      await new Promise((resolve) => setTimeout(resolve, item * 10));
      return item.toString();
    };
    const results = await mapConcurrent(items, 3, mapper);
    expect(results).toEqual(["5", "1", "4", "2", "3"]);
  });
  it("should handle empty arrays correctly", async () => {
    const results = await mapConcurrent([], 2, async (x) => x);
    expect(results).toEqual([]);
  });
  it("should reject if concurrency is less than 1", async () => {
    await expect(mapConcurrent([1], 0, async (x) => x)).rejects.toThrow(
      "concurrency must be at least 1"
    );
  });
  it("should propagate errors from the mapper", async () => {
    const mapper = async (item: number) => {
      if (item === 2) throw new Error("Test error");
      return item;
    };
    await expect(mapConcurrent([1, 2, 3], 2, mapper)).rejects.toThrow(
      "Test error"
    );
  });
});
