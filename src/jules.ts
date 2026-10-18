import { getErrorMessage, isAuthError } from "./errors.js";

export function wrapPermissionError(
  err: unknown,
  needed: string,
  op: string
): Error {
  const msg = getErrorMessage(err);
  if (isAuthError(msg) || msg.includes("Resource not accessible")) {
    return new Error(
      `${op} failed with 403. The github_token likely lacks ${needed}. Add to your workflow:\n` +
        "    permissions:\n      pull-requests: write\n      contents: read\n      checks: write\n" +
        `(original: ${msg})`
    );
  }
  return err instanceof Error ? err : new Error(msg);
}
