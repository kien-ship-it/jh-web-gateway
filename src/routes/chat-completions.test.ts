import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServer } from "../server.js";
import { getDefaultConfig } from "../infra/config.js";
import type { GatewayConfig } from "../infra/types.js";
import type { Page } from "playwright-core";
import type { PagePool } from "../core/page-pool.js";
import { RequestQueue } from "../core/request-queue.js";

// Mock the browser client so tests never touch a real browser
vi.mock("../core/client.js", () => ({
  sendChatRequest: vi.fn(),
  isTokenExpired: vi.fn(() => false),
}));

// Mock auth-capture so tests never touch a real browser for re-capture
vi.mock("../core/auth-capture.js", () => ({
  captureCredentials: vi.fn(),
}));

import { sendChatRequest } from "../core/client.js";
import { captureCredentials } from "../core/auth-capture.js";
import { ReauthLock } from "../core/reauth-lock.js";
import fc from "fast-check";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal fake SSE text with one on_message_delta event */
function makeSse(text: string): string {
  const delta = JSON.stringify({ delta: { content: [{ type: "text", text }] } });
  return [
    `event: on_message_delta\ndata: ${delta}`,
    "",
  ].join("\n\n");
}

const FAKE_CREDENTIALS = {
  bearerToken: "eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.fakesig",
  cookie: "cf_clearance=abc",
  userAgent: "Mozilla/5.0",
};

const FAKE_PAGE = {} as Page;

/** Create a mock PagePool for testing */
function createMockPool(page: Page | null): PagePool {
  const queue = new RequestQueue();
  return {
    stats: { total: 1, busy: 0, available: 1 },
    acquire: async () => ({
      page: page!,
      queue,
      release: () => { },
    }),
    drain: async () => { },
    init: async () => { },
  } as unknown as PagePool;
}

function makeServer(configOverride?: Partial<GatewayConfig>) {
  const config: GatewayConfig = { ...getDefaultConfig(), ...configOverride };
  return createServer(config, {
    getPool: () => createMockPool(FAKE_PAGE),
    getCredentials: () => FAKE_CREDENTIALS,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /v1/chat/completions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendChatRequest).mockResolvedValue({
      rawSseText: makeSse("Hello, world!"),
      conversationId: "conv-123",
      parentMessageId: "msg-456",
    });
  });

  it("returns 400 for missing model field", async () => {
    const app = makeServer();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("missing_field");
    expect(body.error.param).toBe("model");
  });

  it("returns 400 for unknown model", async () => {
    const app = makeServer();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "unknown-model-xyz", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("model_not_found");
  });

  it("returns 400 for missing messages field", async () => {
    const app = makeServer();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-opus-4.5" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("missing_field");
    expect(body.error.param).toBe("messages");
  });

  it("returns 400 for invalid JSON body", async () => {
    const app = makeServer();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_json");
  });

  it("returns 503 when browser page is not available", async () => {
    const config = getDefaultConfig();
    const app = createServer(config, {
      getPool: () => null,
      getCredentials: () => FAKE_CREDENTIALS,
    });
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-opus-4.5", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("chrome_disconnected");
  });

  it("returns 401 when credentials are not available", async () => {
    const config = getDefaultConfig();
    const app = createServer(config, {
      getPool: () => createMockPool(FAKE_PAGE),
      getCredentials: () => null,
    });
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-opus-4.5", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("no_credentials");
  });

  it("returns non-streaming JSON completion for stream: false", async () => {
    const app = makeServer();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4.5",
        messages: [{ role: "user", content: "Say hello" }],
        stream: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("claude-opus-4.5");
    expect(body.choices[0].message.role).toBe("assistant");
    expect(body.choices[0].message.content).toBe("Hello, world!");
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.usage).toBeDefined();
  });

  it("returns streaming SSE for stream: true", async () => {
    const app = makeServer();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4.5",
        messages: [{ role: "user", content: "Say hello" }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    // Should contain SSE data lines
    expect(text).toContain("data: ");
    expect(text).toContain("data: [DONE]");
    // Should contain the content chunk
    expect(text).toContain("Hello, world!");
    // All data lines (except [DONE]) should be valid JSON
    const dataLines = text
      .split("\n")
      .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"));
    for (const line of dataLines) {
      const json = line.slice(6);
      expect(() => JSON.parse(json)).not.toThrow();
      const chunk = JSON.parse(json);
      expect(chunk.object).toBe("chat.completion.chunk");
      expect(chunk.model).toBe("claude-opus-4.5");
      expect(chunk.id).toMatch(/^chatcmpl-/);
    }
  });

  it("calls sendChatRequest with correct model and prompt", async () => {
    const app = makeServer();
    await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4.5",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });
    expect(sendChatRequest).toHaveBeenCalledOnce();
    const [, , chatReq] = vi.mocked(sendChatRequest).mock.calls[0];
    expect(chatReq.model).toBe("claude-opus-4.5");
    expect(chatReq.prompt).toContain("Hello");
  });

  it("returns 401 when bearer auth is required and missing", async () => {
    const app = makeServer({
      auth: { mode: "bearer", token: "secret-token" },
    });
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4.5",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
  });

  it("succeeds when correct bearer token is provided", async () => {
    const app = makeServer({
      auth: { mode: "bearer", token: "secret-token" },
    });
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-token",
      },
      body: JSON.stringify({
        model: "claude-opus-4.5",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(200);
  });

  it("propagates upstream errors as OpenAI error format", async () => {
    vi.mocked(sendChatRequest).mockRejectedValueOnce(
      Object.assign(new Error("JH platform returned 401 — token expired"), { statusCode: 401 }),
    );
    const app = makeServer();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4.5",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
    expect(body.error.message).toContain("token expired");
  });
});


// ── Property 3: Exactly-once 401 retry per request ───────────────────────────
// **Validates: Requirements 6.2**

const FRESH_CREDENTIALS = {
  bearerToken: "fresh-token",
  cookie: "cf_clearance=fresh",
  userAgent: "Mozilla/5.0 Fresh",
  expiresAt: 9999999999,
};

/** Create a server wired with ReauthLock + setCredentials for 401 retry tests */
function makeServerWithReauth() {
  const config = getDefaultConfig();
  const reauthLock = new ReauthLock();
  let setCalled = 0;

  const app = createServer(config, {
    getPool: () => createMockPool(FAKE_PAGE),
    getCredentials: () => FAKE_CREDENTIALS,
    reauthLock,
    setCredentials: () => { setCalled++; },
  });

  return { app, reauthLock, getSetCalledCount: () => setCalled };
}

describe("Property 3: Exactly-once 401 retry per request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries exactly once on 401 and succeeds (single request)", async () => {
    // First call: 401 error. Second call: success.
    const mockSend = vi.mocked(sendChatRequest);
    mockSend
      .mockRejectedValueOnce(
        Object.assign(new Error("401 Unauthorized"), { statusCode: 401 }),
      )
      .mockResolvedValueOnce({
        rawSseText: makeSse("Retried OK"),
        conversationId: "conv-retry",
        parentMessageId: "msg-retry",
      });

    vi.mocked(captureCredentials).mockResolvedValueOnce(FRESH_CREDENTIALS);

    const { app } = makeServerWithReauth();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4.5",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(vi.mocked(captureCredentials)).toHaveBeenCalledTimes(1);
  });

  it("for any N concurrent requests hitting 401, each retries at most once and captureCredentials is called exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        async (concurrentCount) => {
          vi.clearAllMocks();

          // Track per-call invocations: odd calls (1st, 3rd, ...) fail with 401,
          // even calls (2nd, 4th, ...) succeed — simulating first-fail-then-succeed per request.
          let callIndex = 0;
          const mockSend = vi.mocked(sendChatRequest);
          mockSend.mockImplementation(async () => {
            const idx = callIndex++;
            // Each request's first attempt fails, retry succeeds.
            // With N concurrent requests, calls 0..N-1 are first attempts (401),
            // calls N..2N-1 are retries (success).
            if (idx < concurrentCount) {
              const err = Object.assign(new Error("401 Unauthorized"), { statusCode: 401 });
              throw err;
            }
            return {
              rawSseText: makeSse("OK"),
              conversationId: "conv",
              parentMessageId: "msg",
            };
          });

          // captureCredentials should be deduplicated via ReauthLock
          vi.mocked(captureCredentials).mockResolvedValue(FRESH_CREDENTIALS);

          const { app } = makeServerWithReauth();

          // Fire N concurrent requests
          const requests = Array.from({ length: concurrentCount }, () =>
            app.request("/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "claude-opus-4.5",
                messages: [{ role: "user", content: "hi" }],
              }),
            }),
          );

          const responses = await Promise.all(requests);

          // Each request should succeed (200)
          for (const res of responses) {
            expect(res.status).toBe(200);
          }

          // Total sendChatRequest calls: at most 2 per request (original + retry)
          expect(mockSend.mock.calls.length).toBeLessThanOrEqual(concurrentCount * 2);

          // captureCredentials called exactly once due to ReauthLock deduplication
          expect(vi.mocked(captureCredentials)).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
