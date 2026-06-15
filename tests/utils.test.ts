import { describe, it, expect } from "vitest";
import { filterDiff } from "../src/utils.js";

describe("filterDiff", () => {
  it("should return the original diff if no patterns match", () => {
    const diff = `diff --git a/src/index.ts b/src/index.ts
index 123..456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,3 @@
-old
+new
`;
    expect(filterDiff(diff, [/package-lock\.json/])).toBe(diff);
  });

  it("should remove blocks that match the exclude patterns", () => {
    const diff = `diff --git a/src/index.ts b/src/index.ts
index 123..456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,3 @@
-old
+new
diff --git a/package-lock.json b/package-lock.json
index 123..456 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,3 @@
-lock
+lock
diff --git a/src/utils.ts b/src/utils.ts
index 123..456 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,3 +1,3 @@
-utils
+utils
`;
    const filtered = filterDiff(diff, [/package-lock\.json/]);
    expect(filtered).not.toContain("package-lock.json");
    expect(filtered).toContain("src/index.ts");
    expect(filtered).toContain("src/utils.ts");
  });

  it("should handle quoted file paths", () => {
    const diff = `diff --git a/"file with spaces.txt" b/"file with spaces.txt"
index 123..456 100644
--- a/"file with spaces.txt"
+++ b/"file with spaces.txt"
@@ -1,3 +1,3 @@
-a
+b
`;
    const filtered = filterDiff(diff, [/spaces\.txt/]);
    expect(filtered).toBe("");
  });

  it("should handle empty diffs", () => {
    expect(filterDiff("", [/test/])).toBe("");
  });

  it("should handle diff without newlines properly", () => {
    expect(filterDiff("diff --git a/test b/test", [/test/])).toBe("");
  });
});
