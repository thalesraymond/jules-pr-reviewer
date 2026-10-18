export function sleep(ms: number): Promise<void> {
  if (ms < 0) {
    return Promise.reject(
      new Error("sleep delay must be a non-negative number")
    );
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function splitDiff(diff: string): string[] {
  if (!diff) return [];
  const sections: string[] = [];
  const regex = /^diff --git /gm;
  let match = regex.exec(diff);
  if (!match) return [diff];
  if (match.index > 0) {
    sections.push(diff.slice(0, match.index));
  }
  let prevIndex = match.index;
  match = regex.exec(diff);
  while (match) {
    sections.push(diff.slice(prevIndex, match.index));
    prevIndex = match.index;
    match = regex.exec(diff);
  }
  sections.push(diff.slice(prevIndex));
  return sections;
}
