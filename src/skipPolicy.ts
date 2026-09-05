import { parseListInput } from "./filtering.js";
import {
  shouldIgnoreTitle,
  shouldIgnoreAuthor,
  evaluateLabelPolicy,
} from "./ignore.js";

export type SkipPolicyConfig = {
  skipDrafts: boolean;
  skipForks: boolean;
  bypassLabel: string;
  ignoreTitleKeywords?: string;
  ignoreAuthors?: string;
  reviewLabels?: string;
};

export type PullRequestForSkipPolicy = {
  draft?: boolean;
  head?: { repo?: { full_name?: string } };
  title?: string;
  user?: { login?: string };
  labels?: { name: string }[];
  [key: string]: unknown;
};

export type SkipDecision = {
  skip: boolean;
  reason?: string;
  warning?: string;
};

export function evaluateSkipPolicy(
  pr: PullRequestForSkipPolicy,
  config: SkipPolicyConfig,
  ownerRepo: string
): SkipDecision {
  const isDraft = pr.draft ?? false;
  const isFork = pr.head?.repo?.full_name !== ownerRepo;
  const hasBypassLabel = (pr.labels ?? []).some(
    (l) => l.name === config.bypassLabel && config.bypassLabel.length > 0
  );

  if (isDraft && config.skipDrafts) {
    return { skip: true, reason: "Skipping draft PR." };
  }

  if (isFork && config.skipForks) {
    return {
      skip: true,
      reason: "Skipping fork PR (skip_forks=true).",
    };
  }

  if (hasBypassLabel) {
    return {
      skip: true,
      reason: `Bypass label "${config.bypassLabel}" present — skipping review.`,
    };
  }

  const ignoreTitleKeywords = parseListInput(config.ignoreTitleKeywords);
  if (shouldIgnoreTitle(pr.title ?? "", ignoreTitleKeywords)) {
    return {
      skip: true,
      reason:
        "PR title matches an ignore_title_keywords entry — skipping review.",
    };
  }

  const ignoreAuthors = parseListInput(config.ignoreAuthors);
  if (shouldIgnoreAuthor(pr.user?.login, ignoreAuthors)) {
    return {
      skip: true,
      reason: `PR author "${pr.user?.login}" is in ignore_authors — skipping review.`,
    };
  }

  const reviewLabels = parseListInput(config.reviewLabels);
  if (reviewLabels.length > 0) {
    const labelDecision = evaluateLabelPolicy(pr.labels, reviewLabels);
    if (!labelDecision.evaluable) {
      return {
        skip: false,
        warning:
          labelDecision.reason ??
          "review_labels cannot be evaluated: the event payload did not include PR labels (labels are not guaranteed in pull_request payloads). Continuing the review.",
      };
    }

    if (labelDecision.skip) {
      return {
        skip: true,
        reason:
          labelDecision.reason ?? "review_labels matched — skipping review.",
      };
    }
  }

  return { skip: false };
}
