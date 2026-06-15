export function filterDiff(diff: string, excludePatterns: RegExp[]): string {
  if (!diff) return diff;

  const lines = diff.split("\n");
  const filteredLines: string[] = [];
  let isExcluding = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for the start of a new file diff
    if (line.startsWith("diff --git ")) {
      // Extract file path from "diff --git a/file1 b/file2" or similar
      const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
      let filename = "";
      if (match) {
        filename = match[2];
      } else {
        // Handle quoted paths if any, or general match
        const parts = line.substring(11).split(" b/");
        if (parts.length === 2) {
          filename = parts[1];
        } else {
          // fallback, just use the line to match against
          filename = line;
        }
      }

      // Check if filename matches any exclude pattern
      isExcluding = excludePatterns.some((pattern) => pattern.test(filename));
    }

    if (!isExcluding) {
      filteredLines.push(line);
    }
  }

  return filteredLines.join("\n");
}
