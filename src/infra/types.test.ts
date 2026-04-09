import { describe, it, expect } from "vitest";
import { MODEL_ENDPOINT_MAP } from "./types.js";

describe("types", () => {
  it("MODEL_ENDPOINT_MAP contains expected endpoint mappings", () => {
    expect(MODEL_ENDPOINT_MAP["claude-opus-4.5"]).toBe("AnthropicClaude");
    expect(MODEL_ENDPOINT_MAP["claude-sonnet-4.5"]).toBe("AnthropicClaude");
    // Every value should be a non-empty string
    for (const [key, value] of Object.entries(MODEL_ENDPOINT_MAP)) {
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("MODEL_ENDPOINT_MAP has at least one entry", () => {
    expect(Object.keys(MODEL_ENDPOINT_MAP).length).toBeGreaterThan(0);
  });
});
