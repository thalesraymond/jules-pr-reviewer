import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sleep, formatDuration } from "../src/utils.js";

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

describe("formatDuration utility", () => {
  it("should return ms for durations under 1 second", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("should return seconds for durations under 1 minute", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(45000)).toBe("45s");
    expect(formatDuration(59999)).toBe("59s");
  });

  it("should return minutes and seconds for durations under 1 hour", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(83000)).toBe("1m 23s");
    expect(formatDuration(3599999)).toBe("59m 59s");
  });

  it("should return hours, minutes, and seconds for durations 1 hour or more", () => {
    expect(formatDuration(3600000)).toBe("1h 0m 0s");
    expect(formatDuration(3661000)).toBe("1h 1m 1s");
    expect(formatDuration(7259000)).toBe("2h 0m 59s");
  });

  it("should throw an error for negative values", () => {
    expect(() => formatDuration(-1)).toThrow(
      "Duration must be a non-negative number"
    );
    expect(() => formatDuration(-100)).toThrow(
      "Duration must be a non-negative number"
    );
  });
});
