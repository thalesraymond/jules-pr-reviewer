import { describe, it, expectTypeOf } from "vitest";
import type { DiffMode } from "../src/types.js";

describe("DiffMode type", () => {
  it("constrains to prompt or agentic", () => {
    expectTypeOf<DiffMode>().toMatchTypeOf<"prompt" | "agentic">();
  });
});
