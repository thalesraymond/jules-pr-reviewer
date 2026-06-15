export function filterDiff(diffText: string, ignorePatterns: RegExp[]): string {
  if (!diffText || ignorePatterns.length === 0) return diffText;

  // Split by "diff --git " keeping the delimiter.
  // We use lookahead so the chunks retain the "diff --git " prefix.
  // The first split might be empty if the diff starts exactly with "diff --git ".
  const chunks = diffText.split(/(?=^diff --git )/m);

  return chunks
    .filter((chunk) => {
      // If it doesn't look like a file chunk, keep it (e.g. empty string or preface)
      if (!chunk.startsWith("diff --git ")) return true;

      // Extract the filename. The first line is typically:
      // diff --git a/path/to/file b/path/to/file
      // Or quoted: diff --git "a/path/to/file" "b/path/to/file"
      const firstLine = chunk.split("\n")[0] || "";

      let fileName = "";
      // Look for the "b/" path at the end of the line.
      const bQuotedPathMatch = firstLine.match(/ "b\/(.+?)"$/);
      const bPathMatch = firstLine.match(/ b\/(.+)$/);

      if (bQuotedPathMatch) {
        fileName = bQuotedPathMatch[1];
      } else if (bPathMatch) {
        fileName = bPathMatch[1];
      } else {
        // Fallback: If we couldn't parse the file name, keep the chunk safely.
        return true;
      }

      // If the filename matches any ignore pattern, remove it.
      return !ignorePatterns.some((pattern) => pattern.test(fileName));
    })
    .join("");
}
