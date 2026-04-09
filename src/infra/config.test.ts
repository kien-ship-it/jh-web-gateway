import { describe, it, expect } from "vitest";
import { getDefaultConfig, getConfigPath } from "./config.js";

describe("config", () => {
  it("getDefaultConfig returns valid defaults", () => {
    const config = getDefaultConfig();
    expect(config.cdpUrl).toBe("http://127.0.0.1:9222");
    expect(config.port).toBe(8741);
    expect(config.defaultModel).toBe("claude-opus-4.5");
    expect(config.defaultEndpoint).toBe("AnthropicClaude");
    expect(config.credentials).toBeNull();
    expect(config.auth.mode).toBe("none");
    expect(config.auth.token).toBeNull();
    expect(config.maxQueueWaitMs).toBe(120000);
  });

  it("getConfigPath returns a path under home directory", () => {
    const path = getConfigPath();
    expect(path).toContain(".jh-gateway");
    expect(path).toContain("config.json");
  });
});
