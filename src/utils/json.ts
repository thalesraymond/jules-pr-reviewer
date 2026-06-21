/**
 * Safely extracts and parses JSON from a string, handling markdown blocks
 * and conversational text wrapper fallbacks.
 */
export function extractAndParseJSON<T>(message: string): T {
  // 1. Try to extract from ```json ... ``` or ``` ... ```
  const blockRegex = /```(?:json)?\n([\s\S]*?)\n```/i;
  const match = message.match(blockRegex);
  if (match) {
    try {
      return JSON.parse(match[1]) as T;
    } catch {
      // If block extraction fails, fall through to other methods
    }
  }

  // 2. Try parsing the raw string directly
  try {
    return JSON.parse(message) as T;
  } catch {
    // If direct parse fails, fall through to curly/square bracket extraction
  }

  // 3. Fallback: try finding the first and last { } or [ ] to strip conversational text
  const firstCurly = message.indexOf("{");
  const lastCurly = message.lastIndexOf("}");
  const firstSquare = message.indexOf("[");
  const lastSquare = message.lastIndexOf("]");

  let firstIndex = -1;
  let lastIndex = -1;

  if (
    firstCurly !== -1 &&
    lastCurly !== -1 &&
    (firstSquare === -1 || firstCurly < firstSquare)
  ) {
    firstIndex = firstCurly;
    lastIndex = lastCurly;
  } else if (firstSquare !== -1 && lastSquare !== -1) {
    firstIndex = firstSquare;
    lastIndex = lastSquare;
  }

  if (firstIndex !== -1 && lastIndex !== -1 && lastIndex >= firstIndex) {
    try {
      const extracted = message.substring(firstIndex, lastIndex + 1);
      return JSON.parse(extracted) as T;
    } catch {
      // Fall through to throw below
    }
  }

  throw new Error("Failed to extract and parse valid JSON from the response.");
}
