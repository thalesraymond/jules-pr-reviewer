import { describe, it, expect } from "vitest";
import { getErrorMessage } from "../src/errors.js";

describe("getErrorMessage", () => {
  it("should extract message from an Error instance", () => {
    const error = new Error("This is an error");
    expect(getErrorMessage(error)).toBe("This is an error");
  });

  it("should extract message from an object with a message property", () => {
    const error = { message: "Custom object error" };
    expect(getErrorMessage(error)).toBe("Custom object error");
  });

  it("should convert a plain string to a string", () => {
    const error = "String error";
    expect(getErrorMessage(error)).toBe("String error");
  });

  it("should handle null and undefined", () => {
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("should handle other primitives", () => {
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage(true)).toBe("true");
  });
});
