import { describe, it, expect } from "vitest";
import { parseReviewResponse } from "../src/validation.js";

describe("parseReviewResponse", () => {
  it("extracts and validates JSON from a fenced block", () => {
    const input =
      '```json\n{"verdict":"approve","summary":"ok","resolvedCommentIds":[],"newComments":[]}\n```';
    const result = parseReviewResponse(input);
    expect(result.verdict).toBe("approve");
    expect(result.summary).toBe("ok");
  });

  it("extracts JSON object from surrounding prose", () => {
    const input =
      'Review summary:\n{"summary":"ok","verdict":"comment","resolvedCommentIds":[],"newComments":[]}\nThanks';
    const result = parseReviewResponse(input);
    expect(result.verdict).toBe("comment");
  });

  it("throws when input contains no valid JSON", () => {
    expect(() => parseReviewResponse("plain text")).toThrow();
  });

  it("extracts the outer JSON object even when it is wrapped in a fenced block containing nested ``` fences", () => {
    const body = {
      summary: "There is a problem",
      verdict: "block",
      resolvedCommentIds: [] as number[],
      newComments: [
        {
          file: "src/index.ts",
          line: 10,
          severity: "High",
          confidence: "High",
          message: "fix me",
          promptForAgents: "fix it",
          suggestion: '```bash\nmkdir -p "foo"\n```',
        },
      ],
    };
    const input = `Here is the review:\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\`\nDone.`;

    expect(parseReviewResponse(input)).toEqual(body);
  });

  it("extracts a raw JSON object containing markdown-style backticks", () => {
    const body = {
      summary: "This PR introduces OpenSpec agent skills and workflows.",
      verdict: "block",
      resolvedCommentIds: [] as number[],
      newComments: [
        {
          file: ".agent/skills/openspec-archive-change/SKILL.md",
          line: 73,
          severity: "High",
          confidence: "High",
          message: "The file is incomplete or truncated.",
          promptForAgents: "Modify the file.",
          suggestion:
            'Create an `archive` directory:\n```bash\nmkdir -p "<planningHome.changesDir>/archive"\n```',
        },
      ],
    };
    const input = `Submitted the review via the user response in strict JSON format.\n\n${JSON.stringify(body)}`;

    expect(parseReviewResponse(input)).toEqual(body);
  });

  it("successfully validates a correctly formed payload with all fields present", () => {
    const payload = {
      summary: "Looks good",
      verdict: "approve",
      resolvedCommentIds: [1, 2],
      newComments: [
        {
          file: "src/index.ts",
          line: 10,
          severity: "High",
          confidence: "High",
          message: "Fix this",
          promptForAgents: "Do this",
          suggestion: "const a = 1;",
          startLine: 9,
        },
      ],
    };
    const input = `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
    const result = parseReviewResponse(input);
    expect(result).toEqual(payload);
  });

  it("throws an error if verdict is missing or invalid", () => {
    expect(() => parseReviewResponse("```json\n{}\n```")).toThrow(
      "Invalid or missing verdict"
    );
    expect(() =>
      parseReviewResponse('```json\n{"verdict":"invalid"}\n```')
    ).toThrow("Invalid or missing verdict");
    expect(() => parseReviewResponse("null")).toThrow(
      "Invalid or missing review result object"
    );
  });

  it("supplies a default string for missing or non-string summary", () => {
    const result1 = parseReviewResponse('```json\n{"verdict":"approve"}\n```');
    expect(result1.summary).toBe("No summary provided.");

    const result2 = parseReviewResponse(
      '```json\n{"verdict":"approve","summary":123}\n```'
    );
    expect(result2.summary).toBe("No summary provided.");
  });

  it("filters out non-number items from resolvedCommentIds", () => {
    const payload = {
      verdict: "comment",
      resolvedCommentIds: [1, "two", 3, null],
    };
    const result = parseReviewResponse(
      `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``
    );
    expect(result.resolvedCommentIds).toEqual([1, 3]);
  });

  it("filters out invalid items from newComments", () => {
    const payload = {
      verdict: "comment",
      newComments: [
        null,
        "string",
        { file: "a.ts", line: "not-a-number", message: "msg" }, // invalid line
        { line: 10, message: "msg" }, // missing file
        { file: "a.ts", line: 10 }, // missing message
        { file: "b.ts", line: 20, message: "valid" }, // valid
      ],
    };
    const result = parseReviewResponse(
      `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``
    );
    expect(result.newComments).toHaveLength(1);
    expect(result.newComments[0].file).toBe("b.ts");
  });

  it("applies fallback defaults for invalid severity and confidence", () => {
    const payload = {
      verdict: "comment",
      newComments: [
        {
          file: "a.ts",
          line: 10,
          message: "msg",
          severity: "SuperHigh", // invalid
          confidence: 123, // invalid
        },
      ],
    };
    const result = parseReviewResponse(
      `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``
    );
    expect(result.newComments[0].severity).toBe("Info");
    expect(result.newComments[0].confidence).toBe("Low");
  });

  it("preserves changedFiles when present as string array", () => {
    const payload = {
      verdict: "approve",
      summary: "ok",
      resolvedCommentIds: [],
      newComments: [],
      changedFiles: ["src/foo.ts", "src/bar.ts"],
    };
    const result = parseReviewResponse(
      `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``
    );
    expect(result.changedFiles).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("sets changedFiles to undefined when absent", () => {
    const payload = {
      verdict: "approve",
      summary: "ok",
      resolvedCommentIds: [],
      newComments: [],
    };
    const result = parseReviewResponse(
      `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``
    );
    expect(result.changedFiles).toBeUndefined();
  });

  it("ignores non-array changedFiles", () => {
    const payload = {
      verdict: "approve",
      summary: "ok",
      resolvedCommentIds: [],
      newComments: [],
      changedFiles: "not-an-array",
    };
    const result = parseReviewResponse(
      `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``
    );
    expect(result.changedFiles).toBeUndefined();
  });
});
