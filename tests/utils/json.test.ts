import { describe, it, expect } from "vitest";
import { extractAndParseJSON } from "../../src/utils/json.js";

describe("extractAndParseJSON", () => {
  it("parses clean JSON", () => {
    const input = '{"hello": "world"}';
    const result = extractAndParseJSON<{ hello: string }>(input);
    expect(result).toEqual({ hello: "world" });
  });

  it("extracts from a markdown code block", () => {
    const input = `Here is your JSON:
\`\`\`json
{
  "test": 123
}
\`\`\`
Have a nice day!`;
    const result = extractAndParseJSON<{ test: number }>(input);
    expect(result).toEqual({ test: 123 });
  });

  it("extracts from a markdown block without language specifier", () => {
    const input = '```\n{"foo":"bar"}\n```';
    const result = extractAndParseJSON<{ foo: string }>(input);
    expect(result).toEqual({ foo: "bar" });
  });

  it("extracts JSON object hidden in conversational text", () => {
    const input =
      'Sure, here is the object you requested: {"key": "value"}. Let me know if you need anything else.';
    const result = extractAndParseJSON<{ key: string }>(input);
    expect(result).toEqual({ key: "value" });
  });

  it("extracts JSON array hidden in conversational text", () => {
    const input = 'Data array: [1, 2, {"a": "b"}, 4] end of message.';
    const result = extractAndParseJSON<unknown[]>(input);
    expect(result).toEqual([1, 2, { a: "b" }, 4]);
  });

  it("throws an error when no valid JSON is found", () => {
    const input = "This is just a regular string with no JSON.";
    expect(() => extractAndParseJSON(input)).toThrow(
      "Failed to extract and parse valid JSON from the response."
    );
  });

  it("throws an error when JSON is malformed inside brackets", () => {
    const input = 'Bad object: { "key": "value" oops }';
    expect(() => extractAndParseJSON(input)).toThrow(
      "Failed to extract and parse valid JSON from the response."
    );
  });

  it("prefers code blocks over raw {} extraction", () => {
    const input = `Here is some text with { braces }
\`\`\`json
{"actual": "data"}
\`\`\`
More text with { braces }`;
    const result = extractAndParseJSON<{ actual: string }>(input);
    expect(result).toEqual({ actual: "data" });
  });
});
