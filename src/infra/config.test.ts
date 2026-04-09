import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getDefaultConfig, getConfigPath, validateConfig } from "./config.js";

function makeValidRawConfig(overrides: Record<string, unknown> = {}) {
  return {
    cdpUrl: "http://127.0.0.1:9222",
    port: 8741,
    defaultModel: "claude-opus-4.5",
    defaultEndpoint: "AnthropicClaude",
    credentials: null,
    auth: { mode: "none", token: null },
    maxQueueWaitMs: 120000,
    ...overrides,
  };
}

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

  describe("validateConfig expiresAt handling", () => {
    it("defaults expiresAt to 0 when credentials exist but expiresAt is absent", () => {
      const raw = makeValidRawConfig({
        credentials: {
          bearerToken: "tok",
          cookie: "ck",
          userAgent: "ua",
        },
      });
      const config = validateConfig(raw);
      expect(config.credentials).not.toBeNull();
      expect(config.credentials!.expiresAt).toBe(0);
    });

    it("passes through expiresAt when it is a valid number", () => {
      const raw = makeValidRawConfig({
        credentials: {
          bearerToken: "tok",
          cookie: "ck",
          userAgent: "ua",
          expiresAt: 1700000000,
        },
      });
      const config = validateConfig(raw);
      expect(config.credentials!.expiresAt).toBe(1700000000);
    });

    it("defaults expiresAt to 0 when expiresAt is not a number", () => {
      const raw = makeValidRawConfig({
        credentials: {
          bearerToken: "tok",
          cookie: "ck",
          userAgent: "ua",
          expiresAt: "not-a-number",
        },
      });
      const config = validateConfig(raw);
      expect(config.credentials!.expiresAt).toBe(0);
    });

    it("returns null credentials when credentials are null", () => {
      const raw = makeValidRawConfig({ credentials: null });
      const config = validateConfig(raw);
      expect(config.credentials).toBeNull();
    });
  });
});


/**
 * **Validates: Requirements 7.2, 7.3**
 *
 * Property 5: Config backward compatibility with default filling
 *
 * For any valid GatewayConfig JSON object, validateConfig() SHALL succeed
 * and return a valid GatewayConfig with all required fields populated.
 * When credentials exist but expiresAt is missing, it defaults to 0.
 */
describe("Property 5: Config backward compatibility with default filling", () => {
  // Generator for auth mode
  const authModeArb = fc.constantFrom("none" as const, "bearer" as const, "basic" as const);

  // Non-empty string that won't be trimmed to empty (has at least one non-whitespace char)
  const nonEmptyStrArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

  // Generator for credentials (with or without expiresAt)
  const credentialsArb = fc.oneof(
    fc.constant(null),
    fc.record({
      bearerToken: fc.string({ minLength: 1 }),
      cookie: fc.string({ minLength: 1 }),
      userAgent: fc.string({ minLength: 1 }),
    }),
    fc.record({
      bearerToken: fc.string({ minLength: 1 }),
      cookie: fc.string({ minLength: 1 }),
      userAgent: fc.string({ minLength: 1 }),
      expiresAt: fc.nat(),
    }),
  );

  // Generator for a valid raw GatewayConfig object
  const rawConfigArb = fc.record({
    cdpUrl: fc.constantFrom("http://127.0.0.1:9222", "http://localhost:9222", "https://example.com:9222"),
    port: fc.integer({ min: 1, max: 65535 }),
    defaultModel: nonEmptyStrArb,
    defaultEndpoint: nonEmptyStrArb,
    credentials: credentialsArb,
    auth: fc.record({
      mode: authModeArb,
      token: fc.oneof(fc.constant(null), fc.string({ minLength: 1 })),
    }),
    maxQueueWaitMs: fc.double({ min: 0.001, max: 1_000_000, noNaN: true }),
  });

  it("validateConfig always succeeds for valid raw configs and returns all required fields", () => {
    fc.assert(
      fc.property(rawConfigArb, (raw) => {
        const config = validateConfig(raw);

        // All required top-level fields are present and correctly typed
        expect(typeof config.cdpUrl).toBe("string");
        expect(config.cdpUrl).toBe(raw.cdpUrl);
        expect(typeof config.port).toBe("number");
        expect(config.port).toBe(raw.port);
        expect(typeof config.defaultModel).toBe("string");
        expect(config.defaultModel).toBe(raw.defaultModel);
        expect(typeof config.defaultEndpoint).toBe("string");
        expect(config.defaultEndpoint).toBe(raw.defaultEndpoint);
        expect(typeof config.maxQueueWaitMs).toBe("number");
        expect(config.maxQueueWaitMs).toBe(raw.maxQueueWaitMs);

        // auth is always present with correct shape
        expect(config.auth.mode).toBe(raw.auth.mode);
        expect(config.auth.token).toBe(raw.auth.token);

        // credentials: null stays null, object gets all fields
        if (raw.credentials === null) {
          expect(config.credentials).toBeNull();
        } else {
          expect(config.credentials).not.toBeNull();
          expect(config.credentials!.bearerToken).toBe(raw.credentials.bearerToken);
          expect(config.credentials!.cookie).toBe(raw.credentials.cookie);
          expect(config.credentials!.userAgent).toBe(raw.credentials.userAgent);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("expiresAt defaults to 0 when credentials exist but expiresAt is missing", () => {
    const credsWithoutExpiresAtArb = fc.record({
      bearerToken: fc.string({ minLength: 1 }),
      cookie: fc.string({ minLength: 1 }),
      userAgent: fc.string({ minLength: 1 }),
    });

    const rawConfigNoExpiresAtArb = fc.record({
      cdpUrl: fc.constantFrom("http://127.0.0.1:9222", "http://localhost:9222", "https://example.com:9222"),
      port: fc.integer({ min: 1, max: 65535 }),
      defaultModel: nonEmptyStrArb,
      defaultEndpoint: nonEmptyStrArb,
      credentials: credsWithoutExpiresAtArb,
      auth: fc.record({
        mode: authModeArb,
        token: fc.oneof(fc.constant(null), fc.string({ minLength: 1 })),
      }),
      maxQueueWaitMs: fc.double({ min: 0.001, max: 1_000_000, noNaN: true }),
    });

    fc.assert(
      fc.property(rawConfigNoExpiresAtArb, (raw) => {
        const config = validateConfig(raw);
        expect(config.credentials).not.toBeNull();
        expect(config.credentials!.expiresAt).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it("expiresAt is preserved when credentials include a numeric expiresAt", () => {
    const credsWithExpiresAtArb = fc.record({
      bearerToken: fc.string({ minLength: 1 }),
      cookie: fc.string({ minLength: 1 }),
      userAgent: fc.string({ minLength: 1 }),
      expiresAt: fc.nat(),
    });

    const rawConfigWithExpiresAtArb = fc.record({
      cdpUrl: fc.constantFrom("http://127.0.0.1:9222", "http://localhost:9222", "https://example.com:9222"),
      port: fc.integer({ min: 1, max: 65535 }),
      defaultModel: nonEmptyStrArb,
      defaultEndpoint: nonEmptyStrArb,
      credentials: credsWithExpiresAtArb,
      auth: fc.record({
        mode: authModeArb,
        token: fc.oneof(fc.constant(null), fc.string({ minLength: 1 })),
      }),
      maxQueueWaitMs: fc.double({ min: 0.001, max: 1_000_000, noNaN: true }),
    });

    fc.assert(
      fc.property(rawConfigWithExpiresAtArb, (raw) => {
        const config = validateConfig(raw);
        expect(config.credentials).not.toBeNull();
        expect(config.credentials!.expiresAt).toBe(raw.credentials.expiresAt);
      }),
      { numRuns: 100 },
    );
  });
});
