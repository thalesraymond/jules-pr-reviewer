import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type Config, type InputReader } from "../src/config.js";

const DEFAULT_INPUTS: Record<string, string> = {
  jules_api_key: "test-api-key",
  github_token: "test-token",
  fail_on: "never",
  strictness: "chill",
  diff_mode: "prompt",
  skip_drafts: "true",
  skip_forks: "true",
  bypass_label: "jules-override",
  status_context: "jules/review",
  extra_instructions: "",
  rules_file: ".github/jules-review-rules.md",
  rules_directory: ".github/jules-rules",
  ignored_paths: "[]",
  timeout_minutes: "30",
  enable_suggestions: "false",
  enable_approve: "false",
  dedupe: "true",
  large_pr_threshold: "80000",
  large_pr_strategy: "prioritize",
  ignore_title_keywords: "",
  ignore_authors: "",
  review_labels: "",
  min_severity_to_report: "info",
  block_on: "",
};

function makeIo(overrides: Record<string, string> = {}): {
  io: InputReader;
  secrets: string[];
} {
  const values = { ...DEFAULT_INPUTS, ...overrides };
  const secrets: string[] = [];

  const io: InputReader = {
    getInput: (name, options) => {
      const value = values[name] ?? "";
      if (value === "" && options?.required) {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return value;
    },
    getBooleanInput: (name) => {
      const value = values[name] ?? "";
      if (value === "true") return true;
      if (value === "false") return false;
      throw new Error(
        `Input does not meet YAML 1.2 Core Schema specification: ${name}`
      );
    },
    setSecret: (secret) => {
      secrets.push(secret);
    },
  };

  return { io, secrets };
}

function expectConfig(result: { ok: true; config: Config }): Config {
  return result.config;
}

function parseActionYmlInputDefaults(yml: string): Record<string, string> {
  const defaults: Record<string, string> = {};
  let inInputs = false;
  let current: string | undefined;
  for (const line of yml.split("\n")) {
    if (line === "inputs:") {
      inInputs = true;
      continue;
    }
    if (/^\w+:$/.test(line)) {
      inInputs = false;
      continue;
    }
    if (!inInputs) continue;
    const inputMatch = line.match(/^ {2}([A-Za-z0-9_]+):$/);
    if (inputMatch) {
      current = inputMatch[1];
      continue;
    }
    if (!current) continue;
    const defaultMatch = line.match(/^ {4}default: "([^"]*)"$/);
    if (defaultMatch) {
      defaults[current] = defaultMatch[1];
    }
  }
  return defaults;
}

describe("loadConfig", () => {
  beforeEach(() => {
    delete process.env.JULES_API_KEY;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    delete process.env.JULES_API_KEY;
    delete process.env.GITHUB_TOKEN;
  });

  it("returns a fully-populated config when all inputs are valid", () => {
    const { io, secrets } = makeIo({
      fail_on: "any",
      strictness: "quiet",
      diff_mode: "agentic",
      timeout_minutes: "45",
      skip_drafts: "false",
      enable_suggestions: "true",
      dedupe: "false",
      extra_instructions: "Be strict",
      rules_file: ".github/rules.md",
      ignored_paths: '["dist/**", "*.lock"]',
    });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result)).toEqual({
      apiKey: "test-api-key",
      token: "test-token",
      failOn: "any",
      diffMode: "agentic",
      strictness: "quiet",
      skipDrafts: false,
      skipForks: true,
      bypassLabel: "jules-override",
      statusContext: "jules/review",
      extraInstructions: "Be strict",
      rulesFilePath: ".github/rules.md",
      rulesDirectory: ".github/jules-rules",
      ignoredPaths: '["dist/**", "*.lock"]',
      timeoutMinutes: 45,
      enableSuggestions: true,
      enableApprove: false,
      dedupe: false,
      largePrThreshold: 80000,
      largePrStrategy: "prioritize",
      ignoreTitleKeywords: undefined,
      ignoreAuthors: undefined,
      reviewLabels: undefined,
      minSeverityToReport: "Info",
      blockOn: undefined,
    });
    expect(secrets).toEqual(["test-api-key", "test-token"]);
    expect(process.env.JULES_API_KEY).toBe("test-api-key");
    expect(process.env.GITHUB_TOKEN).toBe("test-token");
  });

  it("applies the documented defaults and normalizes empty optional inputs to undefined", () => {
    const { io } = makeIo();

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const config = expectConfig(result);
    expect(config.failOn).toBe("never");
    expect(config.strictness).toBe("chill");
    expect(config.diffMode).toBe("prompt");
    expect(config.skipDrafts).toBe(true);
    expect(config.skipForks).toBe(true);
    expect(config.bypassLabel).toBe("jules-override");
    expect(config.statusContext).toBe("jules/review");
    expect(config.timeoutMinutes).toBe(30);
    expect(config.enableSuggestions).toBe(false);
    expect(config.enableApprove).toBe(false);
    expect(config.dedupe).toBe(true);
    expect(config.largePrThreshold).toBe(80000);
    expect(config.largePrStrategy).toBe("prioritize");
    expect(config.minSeverityToReport).toBe("Info");
    expect(config.blockOn).toBeUndefined();
    expect(config.extraInstructions).toBeUndefined();
    expect(config.rulesFilePath).toBe(".github/jules-review-rules.md");
    expect(config.rulesDirectory).toBe(".github/jules-rules");
    expect(config.ignoredPaths).toBe("[]");
    expect(config.ignoreTitleKeywords).toBeUndefined();
    expect(config.ignoreAuthors).toBeUndefined();
    expect(config.reviewLabels).toBeUndefined();
  });

  it("normalizes an empty rules_directory to undefined (disabled)", () => {
    const { io } = makeIo({ rules_directory: "" });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).rulesDirectory).toBeUndefined();
  });

  it("preserves a custom rules_directory", () => {
    const { io } = makeIo({ rules_directory: "config/jules-rules" });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).rulesDirectory).toBe("config/jules-rules");
  });

  it("falls back to prompt mode and 30 minutes when inputs are empty strings", () => {
    const { io } = makeIo({ diff_mode: "", timeout_minutes: "" });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).diffMode).toBe("prompt");
    expect(expectConfig(result).timeoutMinutes).toBe(30);
  });

  it("clamps timeout_minutes to at least 1", () => {
    const { io } = makeIo({ timeout_minutes: "-5" });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).timeoutMinutes).toBe(1);
  });

  it("falls back to 30 minutes when timeout_minutes is zero or unparseable", () => {
    const zero = loadConfig(makeIo({ timeout_minutes: "0" }).io);
    const garbage = loadConfig(makeIo({ timeout_minutes: "abc" }).io);

    expect(zero.ok).toBe(true);
    expect(garbage.ok).toBe(true);
    if (!zero.ok || !garbage.ok) return;
    expect(expectConfig(zero).timeoutMinutes).toBe(30);
    expect(expectConfig(garbage).timeoutMinutes).toBe(30);
  });

  it("returns ok:false when the Jules API key is missing", () => {
    const { io } = makeIo({ jules_api_key: "" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("jules_api_key");
  });

  it("returns ok:false when the GitHub token is missing", () => {
    const { io } = makeIo({ github_token: "" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("github_token");
  });

  it("does not set the secret envelope when a required input is missing", () => {
    const { io, secrets } = makeIo({ jules_api_key: "" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    expect(secrets).toEqual([]);
    expect(process.env.JULES_API_KEY).toBeUndefined();
    expect(process.env.GITHUB_TOKEN).toBeUndefined();
  });

  it("returns ok:false when fail_on is invalid", () => {
    const { io } = makeIo({ fail_on: "sometimes" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Invalid fail_on: "sometimes"');
  });

  it("falls back to never when fail_on is an empty string", () => {
    const { io } = makeIo({ fail_on: "" });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).failOn).toBe("never");
  });

  it("keeps the runtime defaults in sync with the defaults declared in action.yml", () => {
    const yml = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "action.yml"),
      "utf8"
    );
    const declared = parseActionYmlInputDefaults(yml);
    const requiredInputs = new Set(["jules_api_key", "github_token"]);

    for (const [name, declaredDefault] of Object.entries(declared)) {
      expect(DEFAULT_INPUTS[name], `default for ${name} in action.yml`).toBe(
        declaredDefault
      );
    }
    for (const name of Object.keys(DEFAULT_INPUTS)) {
      if (requiredInputs.has(name)) continue;
      expect(declared, `default declared for ${name}`).toHaveProperty(name);
    }

    const { io } = makeIo();
    const result = loadConfig(io);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result)).toEqual({
      apiKey: "test-api-key",
      token: "test-token",
      failOn: "never",
      strictness: "chill",
      diffMode: "prompt",
      skipDrafts: true,
      skipForks: true,
      bypassLabel: "jules-override",
      statusContext: "jules/review",
      extraInstructions: undefined,
      rulesFilePath: ".github/jules-review-rules.md",
      rulesDirectory: ".github/jules-rules",
      ignoredPaths: "[]",
      timeoutMinutes: 30,
      enableSuggestions: false,
      enableApprove: false,
      dedupe: true,
      largePrThreshold: 80000,
      largePrStrategy: "prioritize",
      ignoreTitleKeywords: undefined,
      ignoreAuthors: undefined,
      reviewLabels: undefined,
      minSeverityToReport: "Info",
      blockOn: undefined,
    });
  });

  it("returns ok:false when diff_mode is invalid", () => {
    const { io } = makeIo({ diff_mode: "hybrid" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Invalid diff_mode: "hybrid"');
  });

  it("returns ok:false when a boolean input is not a boolean", () => {
    const { io } = makeIo({ skip_drafts: "yes" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("skip_drafts");
  });

  it("returns ok:false when getBooleanInput throws for enable_suggestions", () => {
    const { io } = makeIo({ enable_suggestions: "1" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("enable_suggestions");
  });

  it("parses enable_approve as true when set", () => {
    const { io } = makeIo({ enable_approve: "true" });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).enableApprove).toBe(true);
  });

  it("returns ok:false when enable_approve is not a boolean", () => {
    const { io } = makeIo({ enable_approve: "1" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("enable_approve");
  });

  it("parses dedupe as false when dedupe is false", () => {
    const { io } = makeIo({ dedupe: "false" });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).dedupe).toBe(false);
  });

  it("returns ok:false when dedupe is not a boolean", () => {
    const { io } = makeIo({ dedupe: "maybe" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("dedupe");
  });

  it("preserves ignored_paths as a raw string", () => {
    const { io } = makeIo({ ignored_paths: '["dist/**", "*.lock"]' });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).ignoredPaths).toBe('["dist/**", "*.lock"]');
  });

  it("normalizes non-empty optional inputs to their string values", () => {
    const { io } = makeIo({
      extra_instructions: "Focus on security",
      rules_file: ".github/jules-review-rules.md",
    });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).extraInstructions).toBe("Focus on security");
    expect(expectConfig(result).rulesFilePath).toBe(
      ".github/jules-review-rules.md"
    );
  });

  it("parses a custom large_pr_threshold and large_pr_strategy", () => {
    const { io } = makeIo({
      large_pr_threshold: "50000",
      large_pr_strategy: "truncate",
    });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).largePrThreshold).toBe(50000);
    expect(expectConfig(result).largePrStrategy).toBe("truncate");
  });

  it("falls back to defaults when large_pr inputs are empty strings", () => {
    const { io } = makeIo({
      large_pr_threshold: "",
      large_pr_strategy: "",
    });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).largePrThreshold).toBe(80000);
    expect(expectConfig(result).largePrStrategy).toBe("prioritize");
  });

  it("clamps large_pr_threshold to at least 1", () => {
    const negative = loadConfig(makeIo({ large_pr_threshold: "-5" }).io);
    const zero = loadConfig(makeIo({ large_pr_threshold: "0" }).io);

    expect(negative.ok).toBe(true);
    expect(zero.ok).toBe(true);
    if (!negative.ok || !zero.ok) return;
    expect(expectConfig(negative).largePrThreshold).toBe(1);
    expect(expectConfig(zero).largePrThreshold).toBe(80000);
  });

  it("falls back to 80000 when large_pr_threshold is unparseable", () => {
    const result = loadConfig(makeIo({ large_pr_threshold: "abc" }).io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).largePrThreshold).toBe(80000);
  });

  it("returns ok:false when large_pr_strategy is invalid", () => {
    const { io } = makeIo({ large_pr_strategy: "chunk" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Invalid large_pr_strategy: "chunk"');
  });

  it("preserves ignore list inputs as raw strings", () => {
    const { io } = makeIo({
      ignore_title_keywords: '["WIP", "dependabot"]',
      ignore_authors: "octocat\nbot[bot]",
      review_labels: '["security", "-wip"]',
    });

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const config = expectConfig(result);
    expect(config.ignoreTitleKeywords).toBe('["WIP", "dependabot"]');
    expect(config.ignoreAuthors).toBe("octocat\nbot[bot]");
    expect(config.reviewLabels).toBe('["security", "-wip"]');
  });

  it("parses min_severity_to_report as a Severity value", () => {
    const high = loadConfig(makeIo({ min_severity_to_report: "high" }).io);
    const warning = loadConfig(
      makeIo({ min_severity_to_report: "warning" }).io
    );
    const info = loadConfig(makeIo({ min_severity_to_report: "Info" }).io);

    expect(high.ok).toBe(true);
    expect(warning.ok).toBe(true);
    expect(info.ok).toBe(true);
    if (!high.ok || !warning.ok || !info.ok) return;
    expect(expectConfig(high).minSeverityToReport).toBe("High");
    expect(expectConfig(warning).minSeverityToReport).toBe("Warning");
    expect(expectConfig(info).minSeverityToReport).toBe("Info");
  });

  it("returns ok:false when min_severity_to_report is invalid", () => {
    const { io } = makeIo({ min_severity_to_report: "critical" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(
      'Invalid min_severity_to_report: "critical"'
    );
    expect(result.error).toContain("high, warning, info");
  });

  it("parses block_on as a Severity value and leaves it unset when empty", () => {
    const set = loadConfig(makeIo({ block_on: "high" }).io);
    const unset = loadConfig(makeIo({ block_on: "" }).io);

    expect(set.ok).toBe(true);
    expect(unset.ok).toBe(true);
    if (!set.ok || !unset.ok) return;
    expect(expectConfig(set).blockOn).toBe("High");
    expect(expectConfig(unset).blockOn).toBeUndefined();
  });

  it("returns ok:false when block_on is invalid", () => {
    const { io } = makeIo({ block_on: "sometimes" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Invalid block_on: "sometimes"');
    expect(result.error).toContain("high, warning, info");
  });

  it("parses each strictness level", () => {
    const quiet = loadConfig(makeIo({ strictness: "quiet" }).io);
    const chill = loadConfig(makeIo({ strictness: "chill" }).io);
    const assertive = loadConfig(makeIo({ strictness: "assertive" }).io);

    expect(quiet.ok).toBe(true);
    expect(chill.ok).toBe(true);
    expect(assertive.ok).toBe(true);
    if (!quiet.ok || !chill.ok || !assertive.ok) return;
    expect(expectConfig(quiet).strictness).toBe("quiet");
    expect(expectConfig(chill).strictness).toBe("chill");
    expect(expectConfig(assertive).strictness).toBe("assertive");
  });

  it("falls back to chill when strictness is an empty string", () => {
    const result = loadConfig(makeIo({ strictness: "" }).io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(expectConfig(result).strictness).toBe("chill");
  });

  it("returns ok:false when strictness is invalid", () => {
    const { io } = makeIo({ strictness: "extreme" });

    const result = loadConfig(io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Invalid strictness: "extreme"');
    expect(result.error).toContain("quiet, chill, assertive");
  });
});
