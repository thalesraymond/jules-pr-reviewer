import { describe, it, expect } from "vitest";
import { parseIgnoredPaths, filterDiff } from "../src/filtering.js";

describe("parseIgnoredPaths", () => {
  it("returns empty array for empty or undefined input", () => {
    expect(parseIgnoredPaths()).toEqual([]);
    expect(parseIgnoredPaths("")).toEqual([]);
    expect(parseIgnoredPaths("   ")).toEqual([]);
  });

  it("parses valid JSON array strings", () => {
    expect(parseIgnoredPaths('["dist/**", "*.lock"]')).toEqual([
      "dist/**",
      "*.lock",
    ]);
  });

  it("filters out non-string items or empty strings in JSON array", () => {
    expect(
      parseIgnoredPaths('["dist/**", 123, "", null, "  *.lock "]')
    ).toEqual(["dist/**", "*.lock"]);
  });

  it("falls back to comma or newline separated values if not valid JSON", () => {
    expect(parseIgnoredPaths("dist/**, *.lock\nbuild/*")).toEqual([
      "dist/**",
      "*.lock",
      "build/*",
    ]);
  });
});

describe("filterDiff", () => {
  const sampleDiff = `diff --git a/src/index.ts b/src/index.ts
index 1234567..89abcdef 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import * as core from "@actions/core";

diff --git a/dist/index.js b/dist/index.js
index abcdef1..2345678 100644
--- a/dist/index.js
+++ b/dist/index.js
@@ -1,5 +1,5 @@
 module.exports = ...
diff --git a/package-lock.json b/package-lock.json
index 1111111..2222222 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,5 +1,5 @@
 {}`;

  it("returns original diff if ignoredPatterns is empty", () => {
    expect(filterDiff(sampleDiff, [])).toBe(sampleDiff);
  });

  it("filters out matching file blocks from diff", () => {
    const filtered = filterDiff(sampleDiff, ["dist/**", "*.json"]);
    expect(filtered).toContain("src/index.ts");
    expect(filtered).not.toContain("dist/index.js");
    expect(filtered).not.toContain("package-lock.json");
  });

  it("returns empty string if all diff blocks are filtered out", () => {
    const filtered = filterDiff(sampleDiff, ["**/*"]);
    expect(filtered).toBe("");
  });

  it("matches exact paths and glob patterns", () => {
    const diffWithSecrets = `diff --git a/config/secret.json b/config/secret.json
index 123..456 100644
--- a/config/secret.json
+++ b/config/secret.json
@@ -1 +1 @@
-old
+new
diff --git a/src/index.ts b/src/index.ts
index 123..456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1 @@
-old
+new`;

    const patterns = ["config/secret.json"];
    const filtered = filterDiff(diffWithSecrets, patterns);
    expect(filtered).not.toContain("config/secret.json");
    expect(filtered).toContain("src/index.ts");
  });

  it("matches folder prefix when pattern has trailing slash or folder name", () => {
    const diffWithDist = `diff --git a/dist/index.js b/dist/index.js
index 123..456 100644
--- a/dist/index.js
+++ b/dist/index.js
@@ -1 +1 @@
-old
+new`;

    expect(filterDiff(diffWithDist, ["dist/"])).toBe("");
    expect(filterDiff(diffWithDist, ["dist"])).toBe("");
  });
});
