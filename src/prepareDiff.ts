import { fetchDiff, loadRulesFromBase, fetchOpenThreads } from "./github.js";
import {
  parseIgnoredPaths,
  filterDiff,
  extractChangedFilePaths,
} from "./filtering.js";
import { loadPerPathRules } from "./pathRules.js";
import { OpenThread, PathRuleFile } from "./types.js";

export type PrepareDiffConfig = {
  ignoredPaths?: string;
  rulesFilePath?: string;
  rulesDirectory?: string;
};

export type PreparedDiff = {
  diff: string;
  changedFiles: string[];
  rulesFromFile?: string;
  perPathRules: PathRuleFile[];
  openThreads: OpenThread[];
};

export async function prepareDiff(
  octokit: ReturnType<typeof import("@actions/github").getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  diffBaseSha: string,
  rulesBaseSha: string,
  headSha: string,
  config: PrepareDiffConfig
): Promise<PreparedDiff> {
  const [diff, rulesFromFile, openThreads] = await Promise.all([
    fetchDiff(octokit, owner, repo, { number: prNumber }, diffBaseSha, headSha),
    config.rulesFilePath
      ? loadRulesFromBase(
          octokit,
          owner,
          repo,
          config.rulesFilePath,
          rulesBaseSha
        )
      : Promise.resolve(undefined),
    fetchOpenThreads(octokit, owner, repo, prNumber),
  ]);

  const filteredDiff = filterDiff(diff, parseIgnoredPaths(config.ignoredPaths));
  const changedFiles = extractChangedFilePaths(filteredDiff);
  const perPathRules = config.rulesDirectory
    ? await loadPerPathRules(
        octokit,
        owner,
        repo,
        config.rulesDirectory,
        rulesBaseSha,
        changedFiles
      )
    : [];

  return {
    diff: filteredDiff,
    changedFiles,
    rulesFromFile,
    perPathRules,
    openThreads,
  };
}
