import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServer } from "../server.js";
import { getDefaultConfig } from "../infra/config.js";
import type { GatewayConfig } from "../infra/types.js";
import type { Page } from "playwright-core";

// Mock the browser client so tests never touch a real browser
vi.mock("../core/client.js", () => ({
  sendChatRequest: vi.fn(),
  isTokenExpired: vi.fn(() => false),
}));

import { sendChatRequest } from "../core/client.js";

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

function makeServer(configOverride?: Partial<GatewayConfig>) {
  const config: GatewayConfig = { ...getDefaultConfig(), ...configOverride };
  return createServer(config, {
    getPage: () => FAKE_PAGE,
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
      getPage: () => null,
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
      getPage: () => FAKE_PAGE,
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
