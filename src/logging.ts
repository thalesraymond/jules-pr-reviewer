import * as core from "@actions/core";
import {
  StructuredLogEntry,
  StructuredLogEvent,
  ReviewOutputs,
} from "./types.js";

/**
 * Recursively scrub sensitive values from an object to prevent accidental
 * exposure of API keys, tokens, and untrusted PR content in logs.
 */
function scrubSecrets(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    // Don't scrub short strings that are unlikely to contain secrets
    if (value.length < 10) {
      return value;
    }

    let scrubbed = value;

    // Scrub GitHub token from environment or memory
    const token = process.env.GITHUB_TOKEN;
    if (token && value.includes(token)) {
      scrubbed = scrubbed.replaceAll(token, "[REDACTED_TOKEN]");
    }

    // Scrub Jules API key from environment or memory
    const apiKey = process.env.JULES_API_KEY;
    if (apiKey && value.includes(apiKey)) {
      scrubbed = scrubbed.replaceAll(apiKey, "[REDACTED_API_KEY]");
    }

    // Scrub common patterns that likely contain diffs or PR content
    // (e.g., diff headers starting with @@, PR body markers)
    if (
      value.startsWith("diff --git") ||
      value.includes("@@") ||
      value.startsWith("---") ||
      value.startsWith("+++")
    ) {
      return "[REDACTED_DIFF]";
    }

    return scrubbed;
  }

  if (Array.isArray(value)) {
    return value.map(scrubSecrets);
  }

  if (typeof value === "object") {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      // Skip fields that are likely to contain untrusted PR content
      if (
        key === "diff" ||
        key === "prTitle" ||
        key === "prBody" ||
        key === "description" ||
        key === "title"
      ) {
        continue;
      }
      scrubbed[key] = scrubSecrets(val);
    }
    return scrubbed;
  }

  return value;
}

/**
 * Emit a structured log entry as a JSON string prefixed with ::structured::
 * The entry is written via core.info so it appears in the GitHub Actions log.
 */
export function logStructured(
  event: StructuredLogEvent,
  payload: unknown
): void {
  const scrubbed = scrubSecrets(payload);
  const entry: StructuredLogEntry = {
    event,
    timestamp: new Date().toISOString(),
    payload: scrubbed,
  };
  const line = `::structured:: ${JSON.stringify(entry)}`;
  core.info(line);
}

/**
 * Set GitHub Action outputs for the review results.
 * Each field in ReviewOutputs is emitted via core.setOutput.
 */
export function setReviewOutputs(outputs: ReviewOutputs): void {
  core.setOutput("verdict", outputs.verdict);
  core.setOutput("issues_count", outputs.issues_count.toString());
  core.setOutput("high_issues_count", outputs.high_issues_count.toString());
  core.setOutput(
    "warning_issues_count",
    outputs.warning_issues_count.toString()
  );
  core.setOutput("info_issues_count", outputs.info_issues_count.toString());
  if (outputs.session_id) {
    core.setOutput("session_id", outputs.session_id);
  }
}
