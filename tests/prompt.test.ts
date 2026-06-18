import { describe, it, expect } from "vitest";
import { buildReviewPrompt } from "../src/prompt.js";

describe("buildReviewPrompt", () => {
  it("should build a prompt without open threads or rules or extra instructions", () => {
    const prompt = buildReviewPrompt({
      repoFullName: "owner/repo",
      prNumber: 123,
      prTitle: "My PR",
      prBody: "PR Description",
      diff: "+ const a = 1;",
      openThreads: [],
    });

    expect(prompt).toContain("# Repository\nowner/repo (PR #123)");
    expect(prompt).toContain(
      "# UNTRUSTED: PR title\n<pr_title>\nMy PR\n</pr_title>"
    );
    expect(prompt).toContain(
      "# UNTRUSTED: PR description\n<pr_description>\nPR Description\n</pr_description>"
    );
    expect(prompt).toContain(
      "<pr_diff>\n```diff\n+ const a = 1;\n```\n</pr_diff>"
    );
    expect(prompt).not.toContain("# UNTRUSTED: Project-specific rules");
    expect(prompt).not.toContain("# Trusted: Additional instructions");
    expect(prompt).not.toContain("NOTE: The diff was truncated");
    expect(prompt).not.toContain("# Open Review Comments");
  });

  it("should include diff truncated note", () => {
    const prompt = buildReviewPrompt({
      repoFullName: "owner/repo",
      prNumber: 123,
      prTitle: "My PR",
      prBody: "PR Description",
      diff: "+ const a = 1;",
      diffTruncatedNote: "The diff was truncated",
      openThreads: [],
    });

    expect(prompt).toContain("NOTE: The diff was truncated");
  });

  it("should fallback to (no description) when prBody is empty", () => {
    const prompt = buildReviewPrompt({
      repoFullName: "owner/repo",
      prNumber: 123,
      prTitle: "My PR",
      prBody: "",
      diff: "+ const a = 1;",
      openThreads: [],
    });

    expect(prompt).toContain(
      "# UNTRUSTED: PR description\n<pr_description>\n(no description)\n</pr_description>"
    );
  });

  it("should include project specific rules", () => {
    const prompt = buildReviewPrompt({
      repoFullName: "owner/repo",
      prNumber: 123,
      prTitle: "My PR",
      prBody: "desc",
      diff: "+ const a = 1;",
      rulesFromFile: "Do not use console.log",
      openThreads: [],
    });

    expect(prompt).toContain(
      "# UNTRUSTED: Project-specific rules\n<project_rules>\nDo not use console.log\n</project_rules>"
    );
  });

  it("should include extra instructions", () => {
    const prompt = buildReviewPrompt({
      repoFullName: "owner/repo",
      prNumber: 123,
      prTitle: "My PR",
      prBody: "desc",
      diff: "+ const a = 1;",
      extraInstructions: "Be nice",
      openThreads: [],
    });

    expect(prompt).toContain("# Trusted: Additional instructions\nBe nice");
  });

  it("should include open threads", () => {
    const prompt = buildReviewPrompt({
      repoFullName: "owner/repo",
      prNumber: 123,
      prTitle: "My PR",
      prBody: "desc",
      diff: "+ const a = 1;",
      openThreads: [
        {
          index: 1,
          threadId: "t1",
          path: "file.ts",
          line: 10,
          body: "Bad code",
        },
      ],
    });

    expect(prompt).toContain("# Open Review Comments");
    expect(prompt).toContain(
      "[Index 1] File: file.ts, Line: 10\nComment: Bad code"
    );
  });
});
