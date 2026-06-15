import { describe, it, expect } from "vitest";
import { filterDiffFiles } from "../src/diffUtils.js";

describe("filterDiffFiles", () => {
  it("should return empty string if diff is empty", () => {
    expect(filterDiffFiles("", [/package-lock\.json/])).toBe("");
  });

  it("should return the same diff if no patterns are provided", () => {
    const diff = "diff --git a/foo.txt b/foo.txt\nhello";
    expect(filterDiffFiles(diff, [])).toBe(diff);
  });

  it("should filter out files that match the ignore patterns", () => {
    const diff = `diff --git a/foo.txt b/foo.txt
index 123..456 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,2 +1,3 @@
 hello
+world
diff --git a/package-lock.json b/package-lock.json
index 123..456 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,2 +1,2 @@
 {
-  "lock": true
+  "lock": false
 }
diff --git a/bar.txt b/bar.txt
index 123..456 100644
--- a/bar.txt
+++ b/bar.txt
@@ -1 +1,2 @@
 test
+test2
`;

    const expected = `diff --git a/foo.txt b/foo.txt
index 123..456 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,2 +1,3 @@
 hello
+world
diff --git a/bar.txt b/bar.txt
index 123..456 100644
--- a/bar.txt
+++ b/bar.txt
@@ -1 +1,2 @@
 test
+test2
`;

    const result = filterDiffFiles(diff, [/package-lock\.json$/]);
    expect(result).toBe(expected);
  });

  it("should filter out multiple matching files", () => {
    const diff =
      "diff --git a/yarn.lock b/yarn.lock\nlock\ndiff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\nlock2\ndiff --git a/src/main.ts b/src/main.ts\ncode";
    const expected = "diff --git a/src/main.ts b/src/main.ts\ncode";
    const result = filterDiffFiles(diff, [/yarn\.lock$/, /pnpm-lock\.yaml$/]);
    expect(result).toBe(expected);
  });

  it("should keep chunks that don't match standard diff --git header to be safe", () => {
    const diff =
      "some random text\ndiff --git a/package-lock.json b/package-lock.json\nlock";
    const result = filterDiffFiles(diff, [/package-lock\.json$/]);
    // The first chunk "some random text\n" doesn't match standard git diff header
    // so it should be kept
    expect(result).toBe("some random text\n");
  });
});
