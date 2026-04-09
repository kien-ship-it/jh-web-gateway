import { Hono } from "hono";
import { getTokenExpiry } from "../core/auth-capture.js";
import type { GatewayConfig } from "../infra/types.js";

export function healthRouter(config: GatewayConfig, startTime: number): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const uptime = (Date.now() - startTime) / 1000;

    const tokenExpiry =
      config.credentials?.bearerToken
        ? getTokenExpiry(config.credentials.bearerToken) || null
        : null;

    const tokenExpired =
      tokenExpiry !== null && Date.now() / 1000 > tokenExpiry;

    return c.json({
      status: "ok",
      uptime,
      tokenExpiry,
      tokenExpired,
      cdpUrl: config.cdpUrl,
    });
  });

  return app;
}
