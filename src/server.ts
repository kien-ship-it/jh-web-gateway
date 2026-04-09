import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { modelsRouter } from "./routes/models.js";
import { healthRouter } from "./routes/health.js";
import { chatCompletionsRouter } from "./routes/chat-completions.js";
import { authMiddleware } from "./infra/gateway-auth.js";
import { Logger } from "./infra/logger.js";
import type { PagePool } from "./core/page-pool.js";
import type { GatewayConfig, GatewayCredentials, RequestLogEntry } from "./infra/types.js";
import type { ReauthLock } from "./core/reauth-lock.js";

export interface ServerDeps {
  getPool: () => PagePool | null;
  getCredentials: () => GatewayConfig["credentials"];
  reauthLock?: ReauthLock;
  setCredentials?: (creds: GatewayCredentials) => void;
}

export function createServer(config: GatewayConfig, deps?: ServerDeps): Hono {
  const app = new Hono();
  const startTime = Date.now();
  const logger = new Logger();

  // Auth middleware on /v1/* routes
  app.use("/v1/*", authMiddleware(config));

  // Request logging middleware — logs every API request with latency + token estimates
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const latencyMs = Date.now() - start;

    // Extract model from request body for chat completions (best-effort)
    let model: string | null = null;
    if (c.req.method === "POST" && c.req.path.includes("chat/completions")) {
      try {
        // Body already consumed by route; read model from response or stored value
        const bodyText = await c.req.raw.clone().text();
        const parsed = JSON.parse(bodyText);
        model = typeof parsed?.model === "string" ? parsed.model : null;
      } catch {
        // Body may not be re-readable; that's fine
      }
    }

    // Approximate token estimates from response size (1 token ≈ 4 chars)
    const resBody = c.res?.headers?.get("content-length");
    const resSize = resBody ? parseInt(resBody, 10) : 0;

    const entry: RequestLogEntry = {
      timestamp: new Date().toISOString(),
      method: c.req.method,
      path: c.req.path,
      model,
      statusCode: c.res.status,
      latencyMs,
      estimatedTokens: {
        prompt: 0,
        completion: Math.max(0, Math.ceil(resSize / 4)),
      },
    };

    // Fire-and-forget — don't block the response
    logger.log(entry).catch(() => { });
  });

  // Mount routes
  app.route("/v1/models", modelsRouter(config));
  app.route("/health", healthRouter(config, startTime));

  if (deps) {
    app.route(
      "/v1/chat/completions",
      chatCompletionsRouter(config, {
        getPool: deps.getPool,
        getCredentials: deps.getCredentials,
        reauthLock: deps.reauthLock,
        setCredentials: deps.setCredentials,
      }),
    );
  }

  // Global error handler — OpenAI error format
  app.onError((err, c) => {
    return c.json(
      {
        error: {
          message: err.message || "Internal server error",
          type: "server_error",
          code: "internal_error",
          param: null,
        },
      },
      500,
    );
  });

  // 404 handler — OpenAI error format
  app.notFound((c) => {
    return c.json(
      {
        error: {
          message: `Route ${c.req.method} ${c.req.path} not found`,
          type: "invalid_request_error",
          code: "route_not_found",
          param: null,
        },
      },
      404,
    );
  });

  return app;
}

export interface ServerHandle {
  close: () => Promise<void>;
}

export async function startServer(
  config: GatewayConfig,
  deps: ServerDeps & { browser?: { close(): Promise<void> } },
): Promise<ServerHandle> {
  const hostname = "127.0.0.1";
  const app = createServer(config, deps);
  const port = config.port;

  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port, hostname }, () => {
      s.removeListener("error", onError);
      resolve(s);
    });
    const onError = (err: Error) => reject(err);
    s.once("error", onError);
  });

  console.log(`JH Web Gateway listening on http://${hostname}:${port}`);

  let shuttingDown = false;
  const DRAIN_TIMEOUT_MS = 10_000;

  const shutdown = async () => {
    if (shuttingDown) { return; }
    shuttingDown = true;
    console.log("\nShutting down gracefully...");

    // Stop accepting new connections and drain in-flight requests
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        console.log("Drain timeout reached, forcing close.");
        resolve();
      }, DRAIN_TIMEOUT_MS);

      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });

    // Close Chrome CDP connection if available
    if (deps.browser) {
      try {
        await deps.browser.close();
      } catch {
        // Browser may already be disconnected
      }
    }

    console.log("Shutdown complete.");
  };

  // Register signal handlers
  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });

  return { close: shutdown };
}
