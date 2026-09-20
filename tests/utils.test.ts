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

describe("mapConcurrent", () => {
  it("should map an array of items with concurrency", async () => {
    const items = [1, 2, 3, 4, 5];
    const mapper = vi.fn(async (item: number) => {
      await sleep(10);
      return item * 2;
    });

    const result = await mapConcurrent(items, mapper, 2);

    expect(result).toEqual([2, 4, 6, 8, 10]);
    expect(mapper).toHaveBeenCalledTimes(5);
  });

  it("should handle empty array", async () => {
    const items: number[] = [];
    const mapper = vi.fn(async (item: number) => item * 2);

    const result = await mapConcurrent(items, mapper, 2);

    expect(result).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  it("should reject if concurrency is <= 0", async () => {
    const items = [1, 2];
    const mapper = vi.fn(async (item: number) => item * 2);

    await expect(mapConcurrent(items, mapper, 0)).rejects.toThrow(
      "Concurrency must be greater than 0"
    );
    await expect(mapConcurrent(items, mapper, -1)).rejects.toThrow(
      "Concurrency must be greater than 0"
    );
  });

  it("should reject if mapper throws", async () => {
    const items = [1, 2, 3];
    const mapper = vi.fn(async (item: number) => {
      if (item === 2) {
        throw new Error("Mapper error");
      }
      return item * 2;
    });

    await expect(mapConcurrent(items, mapper, 2)).rejects.toThrow(
      "Mapper error"
    );
  });
});
