import { minimatch } from "minimatch";

export function parseListInput(input?: string): string[] {
  if (!input || !input.trim()) {
    return [];
  }

  const trimmed = input.trim();
  const splitList = (raw: string): string[] =>
    raw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .map((s) => s.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"))
      .filter((s) => s.length > 0);

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
    } catch {
      return splitList(trimmed.slice(1, -1));
    }
  }

  return splitList(trimmed);
}

export function parseIgnoredPaths(input?: string): string[] {
  return parseListInput(input);
}

export function extractChangedFilePaths(diff: string): string[] {
  if (!diff) {
    return [];
  }

  const paths: string[] = [];
  const regex =
    /^diff --git (?:"a\/([^"]+)"|a\/(\S+)) (?:"b\/([^"]+)"|b\/(\S+))/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(diff)) !== null) {
    const pathA = (match[1] ?? match[2])!;
    const pathB = (match[3] ?? match[4])!;
    const changed = pathA !== "dev/null" ? pathA : pathB;
    if (changed !== "dev/null") {
      paths.push(changed);
    }
  }

  return paths;
}

export function filterDiff(diff: string, ignoredPatterns: string[]): string {
  if (!diff || !ignoredPatterns || ignoredPatterns.length === 0) {
    return diff;
  }

  const keptSections: string[] = [];
  const regex =
    /^diff --git (?:"a\/([^"]+)"|a\/(\S+)) (?:"b\/([^"]+)"|b\/(\S+))/gm;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let ignoreCurrent = false;

  while ((match = regex.exec(diff)) !== null) {
    if (lastIndex > 0 || (lastIndex === 0 && match.index > 0)) {
      if (!ignoreCurrent) {
        const sectionStr = diff.substring(lastIndex, match.index);
        if (sectionStr.trim()) keptSections.push(sectionStr);
      }
    }

    const pathA = (match[1] ?? match[2])!;
    const pathB = (match[3] ?? match[4])!;
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

  return keptSections.join("");
}

function shouldIgnorePath(
  filePath: string,
  ignoredPatterns: string[]
): boolean {
  if (!ignoredPatterns || ignoredPatterns.length === 0) {
    return false;
  }
  const normalizedFilePath = filePath.replace(/\\/g, "/");

  for (const pattern of ignoredPatterns) {
    const normalizedPattern = pattern.replace(/\\/g, "/");

    const cleanPattern = normalizedPattern.endsWith("/")
      ? normalizedPattern.slice(0, -1)
      : normalizedPattern;

    if (
      normalizedFilePath === cleanPattern ||
      normalizedFilePath.startsWith(cleanPattern + "/")
    ) {
      return true;
    }

    try {
      if (minimatch(normalizedFilePath, normalizedPattern, { dot: true })) {
        return true;
      }
    } catch {
      // Ignore invalid patterns rather than failing the whole action
    }
  }

  return false;
}
