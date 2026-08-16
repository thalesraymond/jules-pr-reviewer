import * as core from "@actions/core";
import * as github from "@actions/github";
import { minimatch } from "minimatch";
import { PathRuleFile } from "./types.js";
import { listFilesInDirectory, loadRulesFromBase } from "./github.js";

export interface PathRuleCandidate {
  path: string;
  glob: string;
}

export function isRuleFile(relativePath: string): boolean {
  return relativePath.endsWith(".md");
}

export function globFromRulePath(relativePath: string): string {
  return relativePath.replace(/\.md$/, "");
}

export function isWellFormedGlob(glob: string): boolean {
  let bracketDepth = 0;
  let braceDepth = 0;
  let escaped = false;

  for (const char of glob) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth -= 1;
      if (bracketDepth < 0) return false;
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth -= 1;
      if (braceDepth < 0) return false;
    }
  }

  return bracketDepth === 0 && braceDepth === 0;
}

export function parseRuleCandidates(
  filesInDir: string[],
  rulesDir: string
): PathRuleCandidate[] {
  const prefix = rulesDir.replace(/\/+$/, "") + "/";

  return filesInDir
    .filter((path) => path.startsWith(prefix) && isRuleFile(path))
    .map((path) => ({
      path,
      glob: globFromRulePath(path.slice(prefix.length)),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function selectMatchingRules(
  candidates: PathRuleCandidate[],
  changedFiles: string[]
): PathRuleCandidate[] {
  const matched: PathRuleCandidate[] = [];

  for (const candidate of candidates) {
    if (!isWellFormedGlob(candidate.glob)) {
      core.warning(
        `Malformed glob "${candidate.glob}" in per-path rules file ${candidate.path} — skipping.`
      );
      continue;
    }

    const matches = changedFiles.some((file) =>
      minimatch(file.replace(/\\/g, "/"), normalizeGlob(candidate.glob), {
        dot: true,
      })
    );

    if (matches) {
      matched.push(candidate);
    }
  }

  return matched;
}

function normalizeGlob(glob: string): string {
  return glob.replace(/(?<=^|\/)\*\*(?=[^/*])/g, "**/*");
}

export async function loadPerPathRules(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  rulesDir: string,
  baseSha: string,
  changedFiles: string[]
): Promise<PathRuleFile[]> {
  const filesInDir = await listFilesInDirectory(
    octokit,
    owner,
    repo,
    rulesDir,
    baseSha
  );
  const candidates = parseRuleCandidates(filesInDir, rulesDir);
  const matched = selectMatchingRules(candidates, changedFiles);

  if (matched.length === 0) {
    return [];
  }

  const rules: PathRuleFile[] = [];
  for (const candidate of matched) {
    const content = await loadRulesFromBase(
      octokit,
      owner,
      repo,
      candidate.path,
      baseSha
    );
    if (content === undefined) {
      continue;
    }
    rules.push({ path: candidate.path, glob: candidate.glob, content });
  }

  if (rules.length > 0) {
    core.info(
      `Matched ${rules.length} per-path rule file(s): ${rules
        .map((r) => r.path)
        .join(", ")}`
    );
  }

  return rules;
}
