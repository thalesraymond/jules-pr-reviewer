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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should map items with correct concurrency", async () => {
    const concurrency = 2;
    const items = [1, 2, 3, 4, 5];
    let active = 0;
    let maxActive = 0;

    const mapper = async (item: number) => {
      active++;
      if (active > maxActive) maxActive = active;
      await sleep(100);
      active--;
      return item * 2;
    };

    const promise = mapConcurrent(items, mapper, concurrency);

    // Initial state: 2 active
    await Promise.resolve(); // Microtasks for the first two to start
    expect(maxActive).toBe(2);

    // Advance 100ms - first two complete, next two start
    await vi.advanceTimersByTimeAsync(100);
    expect(maxActive).toBe(2);

    // Advance 100ms - next two complete, last one starts
    await vi.advanceTimersByTimeAsync(100);
    expect(maxActive).toBe(2);

    // Advance 100ms - last one completes
    await vi.advanceTimersByTimeAsync(100);

    const results = await promise;
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxActive).toBe(2);
  });

  it("should return the correct mapped values", async () => {
    const items = [1, 2, 3];
    const results = await mapConcurrent(items, async (item) => item * 2, 2);
    expect(results).toEqual([2, 4, 6]);
  });

  it("should handle empty arrays", async () => {
    const results = await mapConcurrent([], async (item) => item, 2);
    expect(results).toEqual([]);
  });

  it("should throw if an error occurs in the mapper", async () => {
    const items = [1, 2, 3];
    const mapper = async (item: number) => {
      if (item === 2) {
        throw new Error("test error");
      }
      return item;
    };

    await expect(mapConcurrent(items, mapper, 2)).rejects.toThrow("test error");
  });
});
