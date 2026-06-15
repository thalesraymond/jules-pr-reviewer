import { describe, it, expect } from "vitest";
import { filterDiff } from "../src/diff.js";

describe("diff.ts", () => {
  it("filters chunks matching simple ignore patterns", () => {
    const diffText = `diff --git a/package-lock.json b/package-lock.json
index e69de29..d95f3ad 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -0,0 +1 @@
+lockfile content
diff --git a/src/index.ts b/src/index.ts
index e69de29..d95f3ad 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -0,0 +1 @@
+console.log('hi');
`;

    const result = filterDiff(diffText, [new RegExp("package-lock\\.json")]);
    expect(result).not.toContain("package-lock.json");
    expect(result).toContain("src/index.ts");
    expect(result).toContain("console.log('hi');");
  });

  it("handles quoted filenames", () => {
    const diffText = `diff --git "a/my file.txt" "b/my file.txt"
index e69de29..d95f3ad 100644
--- "a/my file.txt"
+++ "b/my file.txt"
@@ -0,0 +1 @@
+text
diff --git a/src/index.ts b/src/index.ts
index e69de29..d95f3ad 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -0,0 +1 @@
+console.log('hi');
`;

    const result = filterDiff(diffText, [new RegExp("my file")]);
    expect(result).not.toContain("my file.txt");
    expect(result).toContain("src/index.ts");
  });

  it("handles empty or missing diffs", () => {
    expect(filterDiff("", [new RegExp("test")])).toBe("");
    expect(filterDiff("   ", [new RegExp("test")])).toBe("   ");
  });

  it("returns original diff if no ignore patterns provided", () => {
    const diffText = "diff --git a/file b/file\n+content";
    expect(filterDiff(diffText, [])).toBe(diffText);
  });

  it("handles diffs with missing newlines properly", () => {
    const diffText = "diff --git a/file b/file";
    expect(filterDiff(diffText, [new RegExp("file")])).toBe("");
  });

  it("keeps chunk if filename cannot be parsed", () => {
    const diffText = "diff --git a/file y/file\n+content";
    expect(filterDiff(diffText, [new RegExp("file")])).toBe(diffText);
  });

  it("keeps chunk if it doesn't start with diff --git", () => {
    const diffText = "Some preface\ndiff --git a/file b/file\n+content";
    const result = filterDiff(diffText, [new RegExp("file")]);
    expect(result).toBe("Some preface\n");
  });

  it("handles empty chunk edge case", () => {
    // If firstLine is undefined (e.g., chunk doesn't have a newline), the fallback is hit
    // Though it's hard to simulate `.split("\\n")[0]` returning undefined on a string.
    // Instead we can just trigger the fallback by providing malformed diffs.
    const diffText = "diff --git ";
    expect(filterDiff(diffText, [new RegExp("foo")])).toBe(diffText);
  });
});
