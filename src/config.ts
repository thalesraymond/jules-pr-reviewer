import { DiffMode, FailOn, LargePrStrategy } from "./types.js";
import { getErrorMessage } from "./errors.js";

export interface InputReader {
  getInput(name: string, options?: { required?: boolean }): string;
  getBooleanInput(name: string): boolean;
  setSecret(secret: string): void;
}

export interface Config {
  apiKey: string;
  token: string;
  failOn: FailOn;
  diffMode: DiffMode;
  skipDrafts: boolean;
  skipForks: boolean;
  bypassLabel: string;
  statusContext: string;
  extraInstructions?: string;
  rulesFilePath?: string;
  ignoredPaths?: string;
  timeoutMinutes: number;
  enableSuggestions: boolean;
  dedupe: boolean;
  largePrThreshold: number;
  largePrStrategy: LargePrStrategy;
}

export type ConfigResult =
  { ok: true; config: Config } | { ok: false; error: string };

const VALID_FAIL_ON: readonly FailOn[] = ["never", "blocking", "any"];
const VALID_DIFF_MODES: readonly DiffMode[] = ["prompt", "agentic"];
const VALID_LARGE_PR_STRATEGIES: readonly LargePrStrategy[] = [
  "truncate",
  "prioritize",
];
const DEFAULT_DIFF_MODE: DiffMode = "prompt";
const DEFAULT_TIMEOUT_MINUTES = 30;
const DEFAULT_LARGE_PR_THRESHOLD = 80_000;
const DEFAULT_LARGE_PR_STRATEGY: LargePrStrategy = "prioritize";

function isFailOn(value: string): value is FailOn {
  return VALID_FAIL_ON.some((v) => v === value);
}

function isDiffMode(value: string): value is DiffMode {
  return VALID_DIFF_MODES.some((v) => v === value);
}

function isLargePrStrategy(value: string): value is LargePrStrategy {
  return VALID_LARGE_PR_STRATEGIES.some((v) => v === value);
}

function normalizeOptional(value: string): string | undefined {
  return value === "" ? undefined : value;
}

export function loadConfig(io: InputReader): ConfigResult {
  let apiKey: string;
  let token: string;
  try {
    apiKey = io.getInput("jules_api_key", { required: true });
    token = io.getInput("github_token", { required: true });
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }

  io.setSecret(apiKey);
  io.setSecret(token);
  process.env.JULES_API_KEY = apiKey;
  process.env.GITHUB_TOKEN = token;

  const failOnRaw = io.getInput("fail_on");
  if (!isFailOn(failOnRaw)) {
    return {
      ok: false,
      error: `Invalid fail_on: "${failOnRaw}". Must be one of: ${VALID_FAIL_ON.join(", ")}.`,
    };
  }

  const diffModeRaw = io.getInput("diff_mode") || DEFAULT_DIFF_MODE;
  if (!isDiffMode(diffModeRaw)) {
    return {
      ok: false,
      error: `Invalid diff_mode: "${diffModeRaw}". Must be one of: prompt, agentic.`,
    };
  }

  const largePrStrategyRaw =
    io.getInput("large_pr_strategy") || DEFAULT_LARGE_PR_STRATEGY;
  if (!isLargePrStrategy(largePrStrategyRaw)) {
    return {
      ok: false,
      error: `Invalid large_pr_strategy: "${largePrStrategyRaw}". Must be one of: ${VALID_LARGE_PR_STRATEGIES.join(", ")}.`,
    };
  }

  let skipDrafts: boolean;
  let skipForks: boolean;
  let enableSuggestions: boolean;
  let dedupe: boolean;
  try {
    skipDrafts = io.getBooleanInput("skip_drafts");
    skipForks = io.getBooleanInput("skip_forks");
    enableSuggestions = io.getBooleanInput("enable_suggestions");
    dedupe = io.getBooleanInput("dedupe");
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }

  return {
    ok: true,
    config: {
      apiKey,
      token,
      failOn: failOnRaw,
      diffMode: diffModeRaw,
      skipDrafts,
      skipForks,
      bypassLabel: io.getInput("bypass_label"),
      statusContext: io.getInput("status_context"),
      extraInstructions: normalizeOptional(io.getInput("extra_instructions")),
      rulesFilePath: normalizeOptional(io.getInput("rules_file")),
      ignoredPaths: normalizeOptional(io.getInput("ignored_paths")),
      timeoutMinutes: Math.max(
        1,
        parseInt(io.getInput("timeout_minutes") || "30", 10) ||
          DEFAULT_TIMEOUT_MINUTES
      ),
      enableSuggestions,
      dedupe,
      largePrThreshold: Math.max(
        1,
        parseInt(io.getInput("large_pr_threshold") || "80000", 10) ||
          DEFAULT_LARGE_PR_THRESHOLD
      ),
      largePrStrategy: largePrStrategyRaw,
    },
  };
}
