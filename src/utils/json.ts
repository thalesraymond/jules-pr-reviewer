export function extractAndParseJSON<T = unknown>(input: string): T {
  // Try direct parsing first
  try {
    return JSON.parse(input) as T;
  } catch {
    // Continue to other strategies
  }

  // Look for markdown JSON block
  const jsonMatch = input.match(/```(?:json)?\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]) as T;
    } catch {
      // Continue to conversational extraction
    }
  }

  // Try extracting possible JSON strings using balanced brace/bracket matching
  const candidates: string[] = [];

  const extractBalanced = (
    str: string,
    openChar: string,
    closeChar: string
  ) => {
    let start = str.indexOf(openChar);
    while (start !== -1) {
      let depth = 0;
      let inString = false;
      let escapeNext = false;

      for (let i = start; i < str.length; i++) {
        const char = str[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === "\\") {
          escapeNext = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === openChar) depth++;
          else if (char === closeChar) depth--;

          if (depth === 0) {
            candidates.push(str.substring(start, i + 1));
            break;
          }
        }
      }

      start = str.indexOf(openChar, start + 1);
    }
  };

  extractBalanced(input, "{", "}");
  extractBalanced(input, "[", "]");

  // Sort candidates by length (longest first, as it's more likely to be the full JSON if it parses)
  candidates.sort((a, b) => b.length - a.length);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Continue trying other candidates
    }
  }

  throw new Error("Failed to extract and parse JSON from input.");
}
