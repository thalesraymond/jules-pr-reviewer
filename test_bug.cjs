const diff = `commit 123
Author: test

diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-a
+b
`;

const regex = /^diff --git (?:"a\/([^"]+)"|a\/(\S+)) (?:"b\/([^"]+)"|b\/(\S+))/gm;
let keptSections = [];
let match;
let lastIndex = 0;
let ignoreCurrent = false;
let ignoredPatterns = [];

function shouldIgnorePath() { return false; }

const firstMatch = regex.exec(diff);
if (firstMatch) {
  if (firstMatch.index > 0) {
    const prologue = diff.substring(0, firstMatch.index);
    if (prologue.trim()) keptSections.push(prologue);
  }
  regex.lastIndex = 0;
} else {
  if (diff.trim()) keptSections.push(diff);
}

while ((match = regex.exec(diff)) !== null) {
  if (lastIndex > 0 || (lastIndex === 0 && match.index > 0)) {
    if (!ignoreCurrent) {
      const sectionStr = diff.substring(lastIndex, match.index);
      if (sectionStr.trim()) keptSections.push(sectionStr);
    }
  }

  const pathA = (match[1] ?? match[2]);
  const pathB = (match[3] ?? match[4]);
  const isPathAIgnored =
    pathA !== "dev/null" && shouldIgnorePath(pathA, ignoredPatterns);
  const isPathBIgnored =
    pathB !== "dev/null" && shouldIgnorePath(pathB, ignoredPatterns);

  ignoreCurrent = isPathAIgnored || isPathBIgnored;
  lastIndex = match.index;
}

if (lastIndex < diff.length && !ignoreCurrent) {
  const sectionStr = diff.substring(lastIndex);
  if (sectionStr.trim()) keptSections.push(sectionStr);
}

console.log(keptSections.join(""));
