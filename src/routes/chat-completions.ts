import { Hono } from "hono";
import { stream as honoStream } from "hono/streaming";
import type { GatewayConfig, GatewayCredentials, OpenAIMessage, OpenAITool } from "../infra/types.js";
import { MODEL_ENDPOINT_MAP } from "../infra/types.js";
import { buildPrompt } from "../core/message-builder.js";
import { sendChatRequest } from "../core/client.js";
import { translateToStream, translateToCompletion } from "../core/stream-translator.js";
import type { PagePool } from "../core/page-pool.js";
import type { ReauthLock } from "../core/reauth-lock.js";
import { captureCredentials } from "../core/auth-capture.js";
import { randomBytes } from "node:crypto";

const MODEL_SET = new Set(Object.keys(MODEL_ENDPOINT_MAP));

interface ChatCompletionsDeps {
  getPool: () => PagePool | null;
  getCredentials: () => GatewayConfig["credentials"];
  reauthLock?: ReauthLock;
  setCredentials?: (creds: GatewayCredentials) => void;
}

export function chatCompletionsRouter(
  _config: GatewayConfig,
  deps: ChatCompletionsDeps,
): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    // Parse request body
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            message: "Request body must be valid JSON",
            type: "invalid_request_error",
            code: "invalid_json",
            param: null,
          },
        },
        400,
      );
    }

    // Validate required fields
    const model = body.model;
    if (typeof model !== "string" || !model) {
      return c.json(
        {
          error: {
            message: "Missing required field: model",
            type: "invalid_request_error",
            code: "missing_field",
            param: "model",
          },
        },
        400,
      );
    }

    if (!MODEL_SET.has(model)) {
      return c.json(
        {
          error: {
            message: `Model '${model}' is not supported. Available models: ${[...MODEL_SET].join(", ")}`,
            type: "invalid_request_error",
            code: "model_not_found",
            param: "model",
          },
        },
        400,
      );
    }

    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return c.json(
        {
          error: {
            message: "Missing or empty required field: messages",
            type: "invalid_request_error",
            code: "missing_field",
            param: "messages",
          },
        },
        400,
      );
    }

    const shouldStream = body.stream === true;
    const tools = (body.tools as OpenAITool[] | undefined) ?? undefined;
    const toolChoice = body.tool_choice as
      | string
      | { type: string; function: { name: string } }
      | undefined;

    // Check page pool availability
    const pool = deps.getPool();
    if (!pool) {
      return c.json(
        {
          error: {
            message: "Chrome browser is not connected. Run `jh-gateway setup` or `jh-gateway auth`.",
            type: "service_unavailable",
            code: "chrome_disconnected",
            param: null,
          },
        },
        503,
      );
    }

    const credentials = deps.getCredentials();
    if (!credentials) {
      return c.json(
        {
          error: {
            message: "No credentials available. Run `jh-gateway auth` to capture credentials.",
            type: "authentication_error",
            code: "no_credentials",
            param: null,
          },
        },
        401,
      );
    }

    const completionId = `chatcmpl-${randomBytes(12).toString("hex")}`;

    // Parallelize prompt building and page acquisition — they're independent
    const [built, acquired] = await Promise.all([
      Promise.resolve(buildPrompt(messages as OpenAIMessage[], tools, toolChoice)),
      pool.acquire(),
    ]);
    const { page, queue, release } = acquired;
    const stats = pool.stats;
    console.log(`[chat] Acquired page (pool: ${stats.busy}/${stats.total} busy)`);

    try {
      // Enqueue and execute via browser client
      const response = await queue.enqueue(() =>
        sendChatRequest(page, credentials, {
          model,
          prompt: built.prompt,
        }),
      );

      if (shouldStream) {
        // Streaming SSE response
        const chunks = translateToStream(response.rawSseText, model, completionId);

        return honoStream(c, async (stream) => {
          c.header("Content-Type", "text/event-stream");
          c.header("Cache-Control", "no-cache");
          c.header("Connection", "keep-alive");

          try {
            for (const chunk of chunks) {
              await stream.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          } catch (streamErr: unknown) {
            // Mid-stream error — emit SSE error event before [DONE]
            const sErr = streamErr as Error;
            const errorEvent = {
              error: {
                message: sErr.message || "An error occurred during streaming",
                type: "server_error",
                code: "stream_error",
                param: null,
              },
            };
            await stream.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
          } finally {
            release();
          }
          await stream.write("data: [DONE]\n\n");
        });
      }

      // Non-streaming JSON response
      release();
      const completion = translateToCompletion(response.rawSseText, model, completionId);
      return c.json(completion);
    } catch (err: unknown) {
      release();
      const error = err as Error & { statusCode?: number };
      const statusCode = error.statusCode ?? 500;

      // ── 401 retry via ReauthLock ──────────────────────────────────────
      if (statusCode === 401 && deps.reauthLock) {
        try {
          const freshCreds = await deps.reauthLock.acquire(async () => {
            const captured = await captureCredentials(_config.cdpUrl);
            return {
              bearerToken: captured.bearerToken,
              cookie: captured.cookie,
              userAgent: captured.userAgent,
            };
          });

          // Update the credential holder so future requests use fresh creds
          deps.setCredentials?.(freshCreds);

          // Re-acquire a page and retry exactly once
          const retry = await pool.acquire();
          try {
            const retryResponse = await retry.queue.enqueue(() =>
              sendChatRequest(retry.page, freshCreds, {
                model: model as string,
                prompt: built.prompt,
              }),
            );

            if (shouldStream) {
              const chunks = translateToStream(retryResponse.rawSseText, model as string, completionId);
              return honoStream(c, async (stream) => {
                c.header("Content-Type", "text/event-stream");
                c.header("Cache-Control", "no-cache");
                c.header("Connection", "keep-alive");
                try {
                  for (const chunk of chunks) {
                    await stream.write(`data: ${JSON.stringify(chunk)}\n\n`);
                  }
                } catch (streamErr: unknown) {
                  const sErr = streamErr as Error;
                  const errorEvent = {
                    error: {
                      message: sErr.message || "An error occurred during streaming",
                      type: "server_error",
                      code: "stream_error",
                      param: null,
                    },
                  };
                  await stream.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
                } finally {
                  retry.release();
                }
                await stream.write("data: [DONE]\n\n");
              });
            }

            retry.release();
            const completion = translateToCompletion(retryResponse.rawSseText, model as string, completionId);
            return c.json(completion);
          } catch {
            retry.release();
            // Retry failed — fall through to return 401
          }
        } catch {
          // Re-capture itself failed — fall through to return 401
        }

        // If we reach here, either re-capture or retry failed → 401
        const reauthErrorBody = {
          error: {
            message: "Authentication failed after automatic re-capture attempt.",
            type: "authentication_error",
            code: "upstream_error",
            param: null,
          },
        };

        if (shouldStream) {
          return honoStream(c, async (stream) => {
            c.header("Content-Type", "text/event-stream");
            c.header("Cache-Control", "no-cache");
            c.header("Connection", "keep-alive");
            await stream.write(`data: ${JSON.stringify(reauthErrorBody)}\n\n`);
            await stream.write("data: [DONE]\n\n");
          });
        }

        return c.json(reauthErrorBody, 401);
      }

      // ── Standard error response ───────────────────────────────────────
      const typeMap: Record<number, string> = {
        400: "invalid_request_error",
        401: "authentication_error",
        403: "permission_error",
        429: "rate_limit_error",
        503: "service_unavailable",
      };

      const errorBody = {
        error: {
          message: error.message || "Internal server error",
          type: typeMap[statusCode] ?? "server_error",
          code: statusCode === 429 ? "queue_overflow" : "upstream_error",
          param: null,
        },
      };

      // If streaming was requested, emit error as SSE event
      if (shouldStream) {
        return honoStream(c, async (stream) => {
          c.header("Content-Type", "text/event-stream");
          c.header("Cache-Control", "no-cache");
          c.header("Connection", "keep-alive");
          await stream.write(`data: ${JSON.stringify(errorBody)}\n\n`);
          await stream.write("data: [DONE]\n\n");
        });
      }

      return c.json(
        errorBody,
        statusCode as 400 | 401 | 403 | 429 | 500 | 503,
      );
    }
  });

  return app;
}
