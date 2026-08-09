import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, type Config, type InputReader } from "../src/config.js";

const DEFAULT_INPUTS: Record<string, string> = {
  jules_api_key: "test-api-key",
  github_token: "test-token",
  fail_on: "blocking",
  diff_mode: "prompt",
  skip_drafts: "true",
  skip_forks: "true",
  bypass_label: "jules-override",
  status_context: "jules/review",
  extra_instructions: "",
  rules_file: "",
  ignored_paths: "",
  timeout_minutes: "30",
  enable_suggestions: "false",
  dedupe: "true",
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
      skipDrafts: false,
      skipForks: true,
      bypassLabel: "jules-override",
      statusContext: "jules/review",
      extraInstructions: "Be strict",
      rulesFilePath: ".github/rules.md",
      ignoredPaths: '["dist/**", "*.lock"]',
      timeoutMinutes: 45,
      enableSuggestions: true,
      dedupe: false,
    });
    expect(secrets).toEqual(["test-api-key", "test-token"]);
    expect(process.env.JULES_API_KEY).toBe("test-api-key");
    expect(process.env.GITHUB_TOKEN).toBe("test-token");
  });

  it("applies defaults and normalizes empty optional inputs to undefined", () => {
    const { io } = makeIo();

    const result = loadConfig(io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const config = expectConfig(result);
    expect(config.failOn).toBe("blocking");
    expect(config.diffMode).toBe("prompt");
    expect(config.skipDrafts).toBe(true);
    expect(config.skipForks).toBe(true);
    expect(config.bypassLabel).toBe("jules-override");
    expect(config.statusContext).toBe("jules/review");
    expect(config.timeoutMinutes).toBe(30);
    expect(config.enableSuggestions).toBe(false);
    expect(config.dedupe).toBe(true);
    expect(config.extraInstructions).toBeUndefined();
    expect(config.rulesFilePath).toBeUndefined();
    expect(config.ignoredPaths).toBeUndefined();
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
});
