import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { splitDiff } from "../src/utils.js";

import { sleep } from "../src/utils.js";

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

describe("splitDiff utility", () => {
  it("should return an empty array for empty diff", () => {
    expect(splitDiff("")).toEqual([]);
  });

  it("should return the entire string if no diff header", () => {
    const diff = "just some text\nwithout a header";
    expect(splitDiff(diff)).toEqual([diff]);
  });

  it("should split correctly when prologue is present", () => {
    const diff =
      "prologue text\nmulti-line\ndiff --git a/b a/b\nsome content\ndiff --git c/d c/d\nother content";
    const expected = [
      "prologue text\nmulti-line\n",
      "diff --git a/b a/b\nsome content\n",
      "diff --git c/d c/d\nother content",
    ];
    expect(splitDiff(diff)).toEqual(expected);
  });

  it("should split correctly without prologue", () => {
    const diff =
      "diff --git a/b a/b\nsome content\ndiff --git c/d c/d\nother content";
    const expected = [
      "diff --git a/b a/b\nsome content\n",
      "diff --git c/d c/d\nother content",
    ];
    expect(splitDiff(diff)).toEqual(expected);
  });
});
