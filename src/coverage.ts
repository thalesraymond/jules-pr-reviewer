import { LargePrStrategy, ReviewCoverage } from "./types.js";

export interface DiffSection {
  path: string;
  text: string;
}

export interface PreparedPromptDiff {
  diff: string;
  diffTruncatedNote?: string;
  coverage?: ReviewCoverage;
}

export function splitDiffSections(diff: string): DiffSection[] {
  if (!diff) {
    return [];
  }

  const byPath = new Map<string, string>();
  const regex =
    /^diff --git (?:"a\/([^"]+)"|a\/(\S+)) (?:"b\/([^"]+)"|b\/(\S+))/gm;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let lastPath: string | null = null;

  while ((match = regex.exec(diff)) !== null) {
    if (lastPath && (lastIndex > 0 || (lastIndex === 0 && match.index > 0))) {
      const sectionStr = diff.substring(lastIndex, match.index);
      if (sectionStr.trim()) {
        byPath.set(lastPath, (byPath.get(lastPath) ?? "") + sectionStr);
      }
    }

    const pathA = (match[1] ?? match[2])!;
    const pathB = (match[3] ?? match[4])!;
    const path = pathA !== "dev/null" ? pathA : pathB;
    if (path !== "dev/null") {
      lastPath = path;
    } else {
      lastPath = null;
    }
    lastIndex = match.index;
  }

  if (lastPath && lastIndex < diff.length) {
    const sectionStr = diff.substring(lastIndex);
    if (sectionStr.trim()) {
      byPath.set(lastPath, (byPath.get(lastPath) ?? "") + sectionStr);
    }
  }

  return [...byPath.entries()].map(([path, text]) => ({ path, text }));
}

export function preparePromptDiff(
  diff: string,
  budget: number,
  strategy: LargePrStrategy
): PreparedPromptDiff {
  const sections = splitDiffSections(diff);

  if (diff.length <= budget) {
    return { diff };
  }

  if (sections.length === 0) {
    return {
      diff: diff.slice(0, budget),
      diffTruncatedNote: buildTruncatedNote(diff.length, budget),
      coverage: { isLarge: true, totalFiles: 0 },
    };
  }

  if (strategy === "truncate") {
    return {
      diff: diff.slice(0, budget),
      diffTruncatedNote: buildTruncatedNote(diff.length, budget),
      coverage: coverageForCut(sections, budget),
    };
  }

  return selectByPriority(sections, budget);
}

function selectByPriority(
  sections: DiffSection[],
  budget: number
): PreparedPromptDiff {
  const sorted = [...sections].sort((a, b) => b.text.length - a.text.length);
  const largest = sorted[0];

  if (largest.text.length > budget) {
    return {
      diff: largest.text.slice(0, budget),
      coverage: makeCoverage(sections, [], [largest.path]),
    };
  }

  const included: string[] = [];
  const kept: string[] = [];
  let used = 0;

  for (const section of sorted) {
    if (used + section.text.length > budget) continue;
    used += section.text.length;
    kept.push(section.text);
    included.push(section.path);
  }

  return {
    diff: kept.join(""),
    coverage: makeCoverage(sections, included, []),
  };
}

function coverageForCut(
  sections: DiffSection[],
  budget: number
): ReviewCoverage {
  const included: string[] = [];
  const partial: string[] = [];
  let used = 0;

  for (const section of sections) {
    if (used + section.text.length <= budget) {
      used += section.text.length;
      included.push(section.path);
    } else if (used < budget) {
      partial.push(section.path);
      break;
    } else {
      break;
    }
  }

  return makeCoverage(sections, included, partial);
}

function makeCoverage(
  sections: DiffSection[],
  includedFiles: string[],
  partialFiles: string[]
): ReviewCoverage {
  const includedSet = new Set([...includedFiles, ...partialFiles]);
  const excludedFiles = sections
    .filter((s) => !includedSet.has(s.path))
    .map((s) => s.path);

  return {
    isLarge: true,
    totalFiles: sections.length,
    reviewedFiles: includedFiles.length + partialFiles.length,
    includedFiles,
    partialFiles,
    excludedFiles,
  };
}

function buildTruncatedNote(total: number, budget: number): string {
  return `The diff was truncated: original ${total} chars, kept first ${budget}. Some changes are not visible in the diff above; your review of the visible portion should state this caveat.`;
}

export function buildPostedCoverageNote(
  coverage: ReviewCoverage | undefined
): string | undefined {
  if (!coverage || !coverage.isLarge || coverage.reviewedFiles === undefined) {
    return undefined;
  }

  const partialFiles = coverage.partialFiles ?? [];
  const excludedFiles = coverage.excludedFiles ?? [];
  const partialNote = partialFiles.length > 0 ? " (one file partially)" : "";
  const excludedNote =
    excludedFiles.length > 0
      ? `\n\nFiles not covered: \`${excludedFiles.join("`, `")}\``
      : "";

  return `> **Large PR:** reviewed ${coverage.reviewedFiles} of ${coverage.totalFiles} changed files${partialNote}.${excludedNote}`;
}
