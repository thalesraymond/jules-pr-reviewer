export function sleep(ms: number): Promise<void> {
  if (ms < 0) {
    return Promise.reject(
      new Error("sleep delay must be a non-negative number")
    );
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Splits a git diff into individual file sections.
 * O(n) performance: Avoids expensive V8 positive-lookahead regex split memory allocations.
 */
export function splitDiff(diff: string): string[] {
  if (!diff) return [];
  const regex = /^diff --git /gm;
  const sections: string[] = [];
  let match = regex.exec(diff);
  if (!match) return [diff];

  if (match.index > 0) {
    sections.push(diff.slice(0, match.index));
  }

  let lastIndex = match.index;
  while ((match = regex.exec(diff)) !== null) {
    sections.push(diff.slice(lastIndex, match.index));
    lastIndex = match.index;
  }
  sections.push(diff.slice(lastIndex));
  return sections;
}
