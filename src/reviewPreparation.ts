import * as core from "@actions/core";
import { fetchDiff, loadRulesFromBase, fetchOpenThreads } from "./github.js";
import {
  parseIgnoredPaths,
  filterDiff,
  extractChangedFilePaths,
} from "./filtering.js";
import { loadPerPathRules } from "./pathRules.js";
import { DiffMode, OpenThread, PathRuleFile } from "./types.js";

export type ReviewPreparationConfig = {
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

export type ReviewScope = {
  action?: string;
  before?: string;
  diffMode: DiffMode;
  baseSha: string;
  headSha: string;
};

export async function prepareReview(
  octokit: ReturnType<typeof import("@actions/github").getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  scope: ReviewScope,
  config: ReviewPreparationConfig
): Promise<PreparedDiff> {
  const isIncremental =
    scope.diffMode === "prompt" &&
    scope.action === "synchronize" &&
    Boolean(scope.before);
  const diffBaseSha =
    isIncremental && scope.before ? scope.before : scope.baseSha;
  if (isIncremental) {
    core.info(
      `Synchronize event detected. Reviewing incremental changes from ${diffBaseSha} to ${scope.headSha}`
    );
  } else {
    core.info(`Reviewing full PR diff from ${diffBaseSha} to ${scope.headSha}`);
  }

  const [diff, rulesFromFile, openThreads] = await Promise.all([
    fetchDiff(
      octokit,
      owner,
      repo,
      { number: prNumber },
      diffBaseSha,
      scope.headSha
    ),
    config.rulesFilePath
      ? loadRulesFromBase(
          octokit,
          owner,
          repo,
          config.rulesFilePath,
          scope.baseSha
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
        scope.baseSha,
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
