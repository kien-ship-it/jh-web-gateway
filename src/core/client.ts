import type { Page } from "playwright-core";
import type {
  GatewayCredentials,
  ChatRequest,
  ChatResponse,
} from "../infra/types.js";
import { MODEL_ENDPOINT_MAP } from "../infra/types.js";
import { captureCredentials } from "./auth-capture.js";

const JH_API_BASE = "https://chat.ai.jh.edu/api";
const JH_DEFAULT_GREETING = "Hello! How can I help you today?";
const NULL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Check if a JWT bearer token has expired.
 * Returns true if the current time exceeds the `exp` claim.
 */
export function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return true;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(payload, "base64").toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const exp = parsed["exp"];
    if (typeof exp !== "number") return true;
    return Date.now() / 1000 > exp;
  } catch {
    return true;
  }
}

/**
 * Execute a chat request via in-browser fetch (Cloudflare bypass).
 * Auto-retries up to 2 times if the stream fetch fails (JH platform flakiness).
 */
export async function sendChatRequest(
  page: Page,
  credentials: GatewayCredentials,
  request: ChatRequest,
  options?: {
    cdpUrl?: string;
    onCredentialsRefreshed?: (creds: GatewayCredentials) => void;
  },
): Promise<ChatResponse> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await sendChatRequestInner(page, credentials, request, options, false);
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      // Only retry on 404 (stream not found) — other errors are real
      if (error.statusCode === 404 && attempt < MAX_ATTEMPTS) {
        console.log(`[gateway] Stream not found, retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);
        // Brief pause before retry
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      throw err;
    }
  }
  // Should never reach here
  throw new Error("Unexpected: all retry attempts exhausted");
}

async function sendChatRequestInner(
  page: Page,
  credentials: GatewayCredentials,
  request: ChatRequest,
  options: {
    cdpUrl?: string;
    onCredentialsRefreshed?: (creds: GatewayCredentials) => void;
  } | undefined,
  isRetry: boolean,
): Promise<ChatResponse> {
  if (!isRetry && isTokenExpired(credentials.bearerToken)) {
    throw Object.assign(
      new Error("Bearer token has expired. Run `jh-gateway auth` to capture fresh credentials."),
      { statusCode: 401 },
    );
  }

  const endpoint = MODEL_ENDPOINT_MAP[request.model];
  if (!endpoint) {
    throw Object.assign(new Error(`Model '${request.model}' is not supported`), { statusCode: 400 });
  }

  const conversationId = request.conversationId ?? crypto.randomUUID();
  const parentMessageId = request.parentMessageId ?? NULL_UUID;
  const messageId = crypto.randomUUID();

  const body = {
    text: request.prompt,
    sender: "User",
    clientTimestamp: new Date().toISOString(),
    isCreatedByUser: true,
    parentMessageId,
    conversationId,
    messageId,
    error: false,
    endpoint,
    endpointType: "custom",
    model: request.model,
    resendFiles: true,
    greeting: JH_DEFAULT_GREETING,
    key: "never",
    modelDisplayLabel: "Claude",
    isTemporary: true,
    isRegenerate: false,
    isContinued: false,
    ephemeralAgent: {
      execute_code: false,
      web_search: false,
      file_search: false,
      artifacts: false,
      mcp: [],
    },
  };

  // Strategy: intercept the stream GET at the network level via page.route().
  // The page's JS fires the GET immediately after POST, but the stream may not
  // be ready yet (server needs time to set it up). We intercept the request,
  // retry with backoff until the stream is available, then fulfill the response
  // to both the page and our code.

  type Result = { error: boolean; status: number; statusText: string; body: string };

  let sseResolve: (v: Result) => void;
  const ssePromise = new Promise<Result>((res) => { sseResolve = res; });
  let sseResolved = false;

  const streamPattern = "**/api/agents/chat/stream/*";

  const routeHandler = async (route: import("playwright-core").Route) => {
    console.log(`[gateway] Route handler intercepted: ${route.request().url()}`);
    const url = route.request().url();

    // Don't use route.fetch() for retries — each call consumes the stream.
    // Instead, poll with Node.js fetch until the stream is ready, then fulfill once.
    // Aggressive early polling — stream is usually ready within 100-300ms
    const delays = [0, 50, 100, 150, 250, 400, 700, 1200, 2000, 3500];
    let lastStatus = 0;
    let lastBody = "";
    let lastHeaders: Record<string, string> = {};

    // Extract headers from the original request to forward them
    const reqHeaders = route.request().headers();

    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) {
        await new Promise((r) => setTimeout(r, delays[i]));
      }
      try {
        // Use Node.js global fetch — NOT route.fetch() — to avoid consuming the stream
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Accept: reqHeaders["accept"] ?? "text/event-stream",
            Authorization: reqHeaders["authorization"] ?? "",
            Cookie: reqHeaders["cookie"] ?? "",
            Referer: reqHeaders["referer"] ?? "",
            "User-Agent": reqHeaders["user-agent"] ?? "",
          },
        });

        lastStatus = response.status;
        lastBody = await response.text();
        lastHeaders = {};
        response.headers.forEach((v, k) => { lastHeaders[k] = v; });

        if (lastStatus === 200) {
          console.log(`[gateway] Stream ready on attempt ${i + 1}, body length: ${lastBody.length}`);
          if (!sseResolved) {
            sseResolved = true;
            sseResolve({ error: false, status: 200, statusText: "OK", body: lastBody });
          }
          // Fulfill the intercepted route with the data we got
          await route.fulfill({ status: 200, headers: lastHeaders, body: lastBody });
          return;
        }

        if (lastStatus !== 404) {
          console.log(`[gateway] Stream non-404 error: ${lastStatus}, body: ${lastBody.slice(0, 200)}`);
          break;
        }
      } catch (err) {
        lastBody = String(err);
        lastStatus = 500;
        break;
      }
    }

    console.log(`[gateway] Stream fetch failed after ${delays.length} attempts, last status: ${lastStatus}`);
    if (!sseResolved) {
      sseResolved = true;
      sseResolve({ error: true, status: lastStatus, statusText: "stream fetch failed", body: lastBody });
    }
    try {
      await route.fulfill({ status: lastStatus, headers: lastHeaders, body: lastBody });
    } catch {
      try { await route.continue(); } catch { /* ignore */ }
    }
  };

  await page.route(streamPattern, routeHandler);

  // POST to start the chat
  const postResult = await page.evaluate(
    async ({
      apiBase,
      bearerToken,
      endpointPath,
      requestBody,
    }: {
      apiBase: string;
      bearerToken: string;
      endpointPath: string;
      requestBody: Record<string, unknown>;
    }) => {
      try {
        const res = await fetch(`${apiBase}/agents/chat/${endpointPath}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${bearerToken}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          return {
            error: true,
            status: res.status,
            statusText: res.statusText,
            body: (await res.text()).slice(0, 2000),
            contentType: "",
          };
        }

        const ct = res.headers.get("content-type") ?? "";

        if (ct.includes("text/event-stream")) {
          const reader = res.body?.getReader();
          if (!reader) return { error: true, status: 500, statusText: "No body", body: "No SSE body", contentType: ct };
          const decoder = new TextDecoder();
          let text = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
          }
          return { error: false, status: 200, statusText: "OK", body: text, contentType: ct };
        }

        const bodyText = await res.text();
        console.log(`[gateway] POST response content-type: ${ct}, body: ${bodyText.slice(0, 500)}`);
        return { error: false, status: 200, statusText: "OK", body: bodyText, contentType: ct };
      } catch (err) {
        return { error: true, status: 500, statusText: "fetch error", body: String(err), contentType: "" };
      }
    },
    {
      apiBase: JH_API_BASE,
      bearerToken: credentials.bearerToken,
      endpointPath: endpoint,
      requestBody: body as unknown as Record<string, unknown>,
    },
  );

  let result: Result;

  if (postResult.error) {
    result = { error: true, status: postResult.status, statusText: postResult.statusText ?? "", body: postResult.body };
    await page.unroute(streamPattern, routeHandler);
  } else if (postResult.contentType.includes("text/event-stream")) {
    result = { error: false, status: 200, statusText: "OK", body: postResult.body };
    await page.unroute(streamPattern, routeHandler);
  } else {
    // POST returned JSON with streamId — the page's JS will GET the stream,
    // and our route handler will intercept it with retry logic.
    // Also fire our own GET as a fallback in case the page doesn't.
    let streamId: string | undefined;
    try {
      streamId = (JSON.parse(postResult.body) as { streamId?: string }).streamId;
    } catch { /* not JSON */ }

    if (!streamId) {
      result = { error: false, status: 200, statusText: "OK", body: postResult.body };
      await page.unroute(streamPattern, routeHandler);
    } else {
      // Fire our own GET as fallback (the route handler intercepts it too)
      const streamUrl = `${JH_API_BASE}/agents/chat/stream/${streamId}`;
      page.evaluate(
        async ({ url, token }: { url: string; token: string }) => {
          await new Promise((r) => setTimeout(r, 10));
          try {
            await fetch(url, {
              method: "GET",
              headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
            });
          } catch { /* route handler captures it */ }
        },
        { url: streamUrl, token: credentials.bearerToken },
      ).catch(() => { /* ignore */ });

      // Wait for the route handler to resolve
      const timeout = new Promise<Result>((res) =>
        setTimeout(() => {
          if (!sseResolved) {
            sseResolved = true;
            res({ error: true, status: 408, statusText: "timeout", body: "Stream capture timed out after 120s" });
          }
        }, 120_000),
      );

      result = await Promise.race([ssePromise, timeout]);
      await page.unroute(streamPattern, routeHandler);
    }
  }

  if (result.error) {
    const status = result.status as number;
    const responseBody = result.body as string;

    if (status === 401 && !isRetry) {
      const cdpUrl = options?.cdpUrl ?? "http://127.0.0.1:9222";
      try {
        await page.reload({ waitUntil: "networkidle" });
        const fresh = await captureCredentials(cdpUrl, 30_000);
        const newCreds: GatewayCredentials = {
          bearerToken: fresh.bearerToken,
          cookie: fresh.cookie,
          userAgent: fresh.userAgent,
        };
        options?.onCredentialsRefreshed?.(newCreds);
        return sendChatRequestInner(page, newCreds, request, options, true);
      } catch {
        throw Object.assign(
          new Error("JH platform returned 401 and automatic re-authentication failed. Run `jh-gateway auth` to capture fresh credentials."),
          { statusCode: 401 },
        );
      }
    }

    if (status === 401) {
      throw Object.assign(
        new Error("JH platform returned 401 after re-authentication attempt. Run `jh-gateway auth` to capture fresh credentials."),
        { statusCode: 401 },
      );
    }

    if (status === 403) {
      throw Object.assign(
        new Error("JH platform returned 403 — Cloudflare session has expired. Please open chat.ai.jh.edu in your browser, complete any challenge, then run `jh-gateway auth`."),
        { statusCode: 403 },
      );
    }

    throw Object.assign(new Error(`JH platform returned ${status}: ${responseBody}`), { statusCode: status });
  }

  console.log(`[gateway] Final result: error=${result.error}, status=${result.status}, body length=${result.body.length}`);

  const rawSseText = result.body as string;
  const { newConversationId, newParentMessageId } =
    extractConversationState(rawSseText, conversationId, messageId);

  return { rawSseText, conversationId: newConversationId, parentMessageId: newParentMessageId };
}

function extractConversationState(
  rawSse: string,
  fallbackConversationId: string | null,
  fallbackParentMessageId: string,
): { newConversationId: string; newParentMessageId: string } {
  let newConversationId = fallbackConversationId ?? "";
  let newParentMessageId = fallbackParentMessageId;

  const blocks = rawSse.split("\n\n");
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let event = "";
    let data = "";
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data = line.slice(6);
      else if (line.startsWith("data:")) data = line.slice(5);
    }
    if (event === "message" && data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed?.isCreatedByUser === false) {
          if (parsed.conversationId) newConversationId = parsed.conversationId;
          if (parsed.messageId) newParentMessageId = parsed.messageId;
        }
        // Also check nested message format
        const msg = parsed?.message;
        if (msg?.isCreatedByUser === false) {
          if (msg.conversationId) newConversationId = msg.conversationId;
          if (msg.messageId) newParentMessageId = msg.messageId;
        }
      } catch { /* skip */ }
    }
  }

  return { newConversationId, newParentMessageId };
}
