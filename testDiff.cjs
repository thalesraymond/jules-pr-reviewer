const { extractChangedFilePaths } = require('./dist/index.js');
// Wait, we don't have it exported from index.js directly. We can just copy the function here to test.
function oldExtract(diff) {
  if (!diff) {
    return [];
  }

  const sections = diff.split(/(?=^diff --git )/m);
  const paths = [];

  for (const section of sections) {
    const headerMatch = section.match(
      /^diff --git (?:"a\/([^"]+)"|a\/(\S+)) (?:"b\/([^"]+)"|b\/(\S+))/m
    );
    if (!headerMatch) continue;
    const pathA = (headerMatch[1] ?? headerMatch[2]);
    const pathB = (headerMatch[3] ?? headerMatch[4]);
    const changed = pathA !== "dev/null" ? pathA : pathB;
    if (changed !== "dev/null") {
      paths.push(changed);
    }
  }

  return paths;
}

function newExtract(diff) {
  if (!diff) {
    return [];
  }
  const paths = [];
  const regex = /^diff --git (?:"a\/([^"\n]+)"|a\/(\S+)) (?:"b\/([^"\n]+)"|b\/(\S+))/gm;
  let match;
  while ((match = regex.exec(diff)) !== null) {
      const pathA = (match[1] ?? match[2]);
      const pathB = (match[3] ?? match[4]);
      const changed = pathA !== "dev/null" ? pathA : pathB;
      if (changed !== "dev/null") {
        paths.push(changed);
      }
  }
  return paths;
}

const d = `diff --git a/package.json b/package.json
index 123..456 100644
--- a/package.json
+++ b/package.json
@@ -1,3 +1,3 @@
 {
-  "version": "1.0.0"
+  "version": "1.0.1"
 }
`;

console.log("OLD", oldExtract(d));
console.log("NEW", newExtract(d));
