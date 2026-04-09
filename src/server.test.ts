import { describe, it, expect } from "vitest";
import { createServer } from "./server.js";
import { getDefaultConfig } from "./infra/config.js";

describe("server", () => {
  const config = getDefaultConfig();
  const app = createServer(config);

  it("GET /v1/models returns model list", async () => {
    const res = await app.request("/v1/models");
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await res.json() as any;
    expect(body.object).toBe("list");
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("id");
    expect(body.data[0].owned_by).toBe("jh-web");
  });

  it("GET /v1/models/:id returns single model", async () => {
    const res = await app.request("/v1/models/claude-opus-4.5");
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await res.json() as any;
    expect(body.id).toBe("claude-opus-4.5");
    expect(body.object).toBe("model");
  });

  it("GET /v1/models/:id returns 404 for unknown model", async () => {
    const res = await app.request("/v1/models/unknown-model");
    expect(res.status).toBe(404);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await res.json() as any;
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("GET /health returns status", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("cdpUrl");
  });

  it("unknown route returns 404 in OpenAI error format", async () => {
    const res = await app.request("/v1/nonexistent");
    expect(res.status).toBe(404);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
    expect(body.error.type).toBe("invalid_request_error");
  });
});
