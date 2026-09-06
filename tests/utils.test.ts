import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sleep, chunkArray } from "../src/utils.js";

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

describe("chunkArray utility", () => {
  it("should chunk an array perfectly", () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("should handle remainder elements", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("should handle empty arrays", () => {
    expect(chunkArray([], 2)).toEqual([]);
  });

  it("should throw error for size <= 0", () => {
    expect(() => chunkArray([1, 2], 0)).toThrow(
      "chunk size must be greater than 0"
    );
    expect(() => chunkArray([1, 2], -1)).toThrow(
      "chunk size must be greater than 0"
    );
  });
});
