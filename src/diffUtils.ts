export function filterDiffFiles(
  diffText: string,
  ignorePatterns: RegExp[]
): string {
  if (!diffText || ignorePatterns.length === 0) {
    return diffText;
  }

  // Split by the start of a git diff block.
  // Using lookahead so we keep the 'diff --git ' as part of the block
  const fileDiffs = diffText.split(/(?=^diff --git )/m);

  const filtered = fileDiffs.filter((fileDiff) => {
    // Attempt to extract the filename being modified.
    // The pattern diff --git a/filename b/filename is standard.
    const match = fileDiff.match(/^diff --git a\/(.+?) b\/(.+?)$/m);

    // If we can't parse the filename, include the diff chunk to be safe
    if (!match) return true;

    const filename = match[2];

    // If the filename matches any of our ignore patterns, exclude this diff chunk
    return !ignorePatterns.some((pattern) => pattern.test(filename));
  });

  return filtered.join("");
}
