import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as core from "@actions/core";
import { logStructured, setReviewOutputs } from "../src/logging.js";

vi.mock("@actions/core");

describe("logging module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GITHUB_TOKEN;
    delete process.env.JULES_API_KEY;
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.JULES_API_KEY;
  });

  describe("logStructured", () => {
    it("emits structured log with event, timestamp, and payload", () => {
      logStructured("review_started", { repoOwner: "alice", prNumber: 42 });

      expect(core.info).toHaveBeenCalledOnce();
      const call = vi.mocked(core.info).mock.calls[0][0];
      expect(call).toMatch(/^::structured:: /);

      const json = call.slice("::structured:: ".length);
      const entry = JSON.parse(json);

      expect(entry.event).toBe("review_started");
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(entry.payload).toEqual({ repoOwner: "alice", prNumber: 42 });
    });

    it("scrubs GitHub token from string values", () => {
      process.env.GITHUB_TOKEN = "ghp_secret123";
      logStructured("review_completed", {
        detail: "Token is ghp_secret123 in this string",
      });

      const call = vi.mocked(core.info).mock.calls[0][0];
      const json = call.slice("::structured:: ".length);
      const entry = JSON.parse(json);

      expect(entry.payload.detail).toContain("[REDACTED_TOKEN]");
      expect(entry.payload.detail).not.toContain("ghp_secret123");
    });

    it("scrubs Jules API key from string values", () => {
      process.env.JULES_API_KEY = "jules_key_abc";
      logStructured("jules_api_called", {
        detail: "API key is jules_key_abc here",
      });

      const call = vi.mocked(core.info).mock.calls[0][0];
      const json = call.slice("::structured:: ".length);
      const entry = JSON.parse(json);

      expect(entry.payload.detail).toContain("[REDACTED_API_KEY]");
      expect(entry.payload.detail).not.toContain("jules_key_abc");
    });

    it("redacts diff content", () => {
      logStructured("review_completed", {
        diffContent: "diff --git a/file.ts b/file.ts\n@@\n+new line",
      });

      const call = vi.mocked(core.info).mock.calls[0][0];
      const json = call.slice("::structured:: ".length);
      const entry = JSON.parse(json);

      expect(entry.payload.diffContent).toBe("[REDACTED_DIFF]");
    });

    it("removes diff, prTitle, prBody, title, and description fields", () => {
      logStructured("review_completed", {
        diff: "--- a/file\n+++ b/file",
        prTitle: "Fix bug #123",
        prBody: "This PR fixes...",
        title: "Some title",
        description: "Some description",
        safeField: "this should remain",
      });

      const call = vi.mocked(core.info).mock.calls[0][0];
      const json = call.slice("::structured:: ".length);
      const entry = JSON.parse(json);

      expect(entry.payload).toEqual({ safeField: "this should remain" });
    });

    it("handles nested objects by scrubbing recursively", () => {
      process.env.GITHUB_TOKEN = "secret_token";
      logStructured("review_completed", {
        nested: {
          value: "Token is secret_token embedded",
          deep: {
            token: "secret_token",
          },
        },
      });

      const call = vi.mocked(core.info).mock.calls[0][0];
      const json = call.slice("::structured:: ".length);
      const entry = JSON.parse(json);

      expect(entry.payload.nested.value).toContain("[REDACTED_TOKEN]");
      expect(entry.payload.nested.deep.token).toContain("[REDACTED_TOKEN]");
    });

    it("handles arrays by scrubbing each element", () => {
      process.env.GITHUB_TOKEN = "secret";
      logStructured("review_completed", {
        items: [
          "first item with secret",
          "second item without",
          { nested: "secret inside" },
        ],
      });

      const call = vi.mocked(core.info).mock.calls[0][0];
      const json = call.slice("::structured:: ".length);
      const entry = JSON.parse(json);

      expect(entry.payload.items[0]).toContain("[REDACTED_TOKEN]");
      expect(entry.payload.items[1]).toBe("second item without");
      expect(entry.payload.items[2].nested).toContain("[REDACTED_TOKEN]");
    });

    it("handles null and undefined values", () => {
      logStructured("review_started", {
        nullValue: null,
        undefinedValue: undefined,
        normalValue: "test",
      });

      const call = vi.mocked(core.info).mock.calls[0][0];
      const json = call.slice("::structured:: ".length);
      const entry = JSON.parse(json);

      expect(entry.payload.nullValue).toBeNull();
      expect(entry.payload.undefinedValue).toBeUndefined();
      expect(entry.payload.normalValue).toBe("test");
    });

    it("does not scrub short strings", () => {
      logStructured("review_started", {
        shortToken: "abc",
        shortKey: "xyz",
      });

      const call = vi.mocked(core.info).mock.calls[0][0];
      const json = call.slice("::structured:: ".length);
      const entry = JSON.parse(json);

      expect(entry.payload.shortToken).toBe("abc");
      expect(entry.payload.shortKey).toBe("xyz");
    });
  });

  describe("setReviewOutputs", () => {
    it("sets all output fields via core.setOutput", () => {
      setReviewOutputs({
        verdict: "approve",
        issues_count: 5,
        high_issues_count: 1,
        warning_issues_count: 2,
        info_issues_count: 2,
        session_id: "sess_123",
      });

      expect(core.setOutput).toHaveBeenCalledWith("verdict", "approve");
      expect(core.setOutput).toHaveBeenCalledWith("issues_count", "5");
      expect(core.setOutput).toHaveBeenCalledWith("high_issues_count", "1");
      expect(core.setOutput).toHaveBeenCalledWith("warning_issues_count", "2");
      expect(core.setOutput).toHaveBeenCalledWith("info_issues_count", "2");
      expect(core.setOutput).toHaveBeenCalledWith("session_id", "sess_123");
      expect(core.setOutput).toHaveBeenCalledTimes(6);
    });

    it("sets verdict to skipped with zero counts", () => {
      setReviewOutputs({
        verdict: "skipped",
        issues_count: 0,
        high_issues_count: 0,
        warning_issues_count: 0,
        info_issues_count: 0,
      });

      expect(core.setOutput).toHaveBeenCalledWith("verdict", "skipped");
      expect(core.setOutput).toHaveBeenCalledWith("issues_count", "0");
      expect(core.setOutput).toHaveBeenCalledWith("high_issues_count", "0");
      expect(core.setOutput).toHaveBeenCalledWith("warning_issues_count", "0");
      expect(core.setOutput).toHaveBeenCalledWith("info_issues_count", "0");
    });

    it("omits session_id when undefined", () => {
      setReviewOutputs({
        verdict: "comment",
        issues_count: 2,
        high_issues_count: 0,
        warning_issues_count: 1,
        info_issues_count: 1,
      });

      expect(core.setOutput).toHaveBeenCalledTimes(5);
      expect(core.setOutput).not.toHaveBeenCalledWith(
        "session_id",
        expect.any(String)
      );
    });

    it("converts numeric counts to strings for setOutput", () => {
      setReviewOutputs({
        verdict: "block",
        issues_count: 10,
        high_issues_count: 5,
        warning_issues_count: 3,
        info_issues_count: 2,
      });

      const calls = vi.mocked(core.setOutput).mock.calls;
      // Find the count calls and verify they are strings
      const countCall = calls.find((c) => c[0] === "issues_count");
      expect(countCall?.[1]).toBe("10");
      expect(typeof countCall?.[1]).toBe("string");
    });
  });
});
