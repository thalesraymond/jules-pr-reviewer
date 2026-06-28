import { describe, it, expect } from "vitest";
import { extractAndParseJSON } from "../../src/utils/json.js";

describe("extractAndParseJSON", () => {
  it("should parse direct JSON string", () => {
    const input = '{"test": "direct"}';
    const result = extractAndParseJSON(input);
    expect(result).toEqual({ test: "direct" });
  });

  it("should parse JSON from a markdown block", () => {
    const input = '```json\n{"test": "markdown"}\n```';
    const result = extractAndParseJSON(input);
    expect(result).toEqual({ test: "markdown" });
  });

  it("should parse JSON from a markdown block without json specifier", () => {
    const input = '```\n{"test": "markdown-no-spec"}\n```';
    const result = extractAndParseJSON(input);
    expect(result).toEqual({ test: "markdown-no-spec" });
  });

  it("should parse JSON from conversational text (object)", () => {
    const input =
      'Here is the result:\n\n{"test": "conversational"}\n\nHope this helps!';
    const result = extractAndParseJSON(input);
    expect(result).toEqual({ test: "conversational" });
  });

  it("should parse JSON array from conversational text", () => {
    const input =
      'Here is the array:\n\n[{"test": "conversational-array"}]\n\nHope this helps!';
    const result = extractAndParseJSON(input);
    expect(result).toEqual([{ test: "conversational-array" }]);
  });

  it("should parse JSON from conversational text with multiple braces", () => {
    const input =
      'Here is the result (it has {braces} and [brackets]):\n\n{"test": "conversational-complex"}\n\nHope this helps {too}!';
    const result = extractAndParseJSON(input);
    expect(result).toEqual({ test: "conversational-complex" });
  });

  it("should throw an error for invalid input", () => {
    const input = "Just some text, no JSON here.";
    expect(() => extractAndParseJSON(input)).toThrow(
      "Failed to extract and parse JSON from input."
    );
  });

  it("should throw an error for invalid JSON format", () => {
    const input = '{"test": "broken"';
    expect(() => extractAndParseJSON(input)).toThrow(
      "Failed to extract and parse JSON from input."
    );
  });

  it("should throw an error for invalid JSON format inside markdown", () => {
    const input = '```json\n{"test": "broken"\n```';
    expect(() => extractAndParseJSON(input)).toThrow(
      "Failed to extract and parse JSON from input."
    );
  });
});
