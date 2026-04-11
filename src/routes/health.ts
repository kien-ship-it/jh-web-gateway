import { Hono } from "hono";
import { getTokenExpiry } from "../core/auth-capture.js";
import type { GatewayConfig, GatewayCredentials } from "../infra/types.js";

export function healthRouter(
  config: GatewayConfig,
  startTime: number,
  deps?: { getCredentials?: () => GatewayCredentials | null },
): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const uptime = (Date.now() - startTime) / 1000;

    // Prefer live credentials from CredentialHolder over the static config snapshot
    const liveCreds = deps?.getCredentials?.() ?? config.credentials;
    const tokenExpiry =
      liveCreds?.bearerToken
        ? getTokenExpiry(liveCreds.bearerToken) || null
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
