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
  return sendChatRequestInner(page, credentials, request, options, false);
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
    isTemporary: false,
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

  // Strategy: use Playwright route interception to capture the SSE stream response
  // at the network level. This avoids race conditions where the page's own JS
  // consumes the stream before our page.evaluate GET can reach it.
  //
  // Flow:
  // 1. Set up a route handler to intercept the SSE stream response
  // 2. POST via page.evaluate to start the chat (returns streamId)
  // 3. The page's own JS will GET /stream/{id} — we intercept that response
  // 4. We read the full SSE body, then fulfill the route so the page isn't broken

  const sseCapture: { resolve: (v: { error: boolean; status: number; statusText: string; body: string }) => void; promise: Promise<{ error: boolean; status: number; statusText: string; body: string }> } = {} as any;
  sseCapture.promise = new Promise((res) => { sseCapture.resolve = res; });

  let routeRegistered = false;

  // Intercept the SSE stream GET at the network level
  const streamPattern = `${JH_API_BASE}/agents/chat/stream/*`;
  const routeHandler = async (route: import("playwright-core").Route) => {
    try {
      const response = await route.fetch();
      const responseBody = await response.text();
      const status = response.status();

      sseCapture.resolve({
        error: status !== 200,
        status,
        statusText: response.statusText(),
        body: responseBody,
      });

      // Fulfill the route so the page's JS gets the response too
      const hdrs: Record<string, string> = {};
      for (const h of response.headersArray()) {
        hdrs[h.name] = h.value;
      }
      await route.fulfill({
        status,
        headers: hdrs,
        body: responseBody,
      });
    } catch (err) {
      sseCapture.resolve({
        error: true,
        status: 500,
        statusText: "route error",
        body: String(err),
      });
      try { await route.continue(); } catch { /* ignore */ }
    }
  };

  try {
    await page.route(streamPattern, routeHandler);
    routeRegistered = true;
  } catch {
    // If route registration fails, fall back to page.evaluate approach
    routeRegistered = false;
  }

  // POST to start the chat via page.evaluate (sends cookies automatically)
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
            Origin: "https://chat.ai.jh.edu",
            Referer: "https://chat.ai.jh.edu/",
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

        const contentType = res.headers.get("content-type") ?? "";

        // If the POST itself returns SSE, read it directly
        if (contentType.includes("text/event-stream")) {
          const reader = res.body?.getReader();
          if (!reader) {
            return { error: true, status: 500, statusText: "No body", body: "No SSE response body", contentType };
          }
          const decoder = new TextDecoder();
          let fullText = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullText += decoder.decode(value, { stream: true });
          }
          return { error: false, status: 200, body: fullText, contentType };
        }

        // Otherwise return the JSON body (should contain streamId)
        const bodyText = await res.text();
        return { error: false, status: 200, body: bodyText, contentType };
      } catch (err) {
        const msg = String(err);
        return { error: true, status: 500, statusText: "fetch error", body: msg, contentType: "" };
      }
    },
    {
      apiBase: JH_API_BASE,
      bearerToken: credentials.bearerToken,
      endpointPath: endpoint,
      requestBody: body as unknown as Record<string, unknown>,
    },
  );

  // Determine result based on POST response
  let result: { error: boolean; status: number; statusText: string; body: string };

  if (postResult.error) {
    result = { error: postResult.error, status: postResult.status, statusText: postResult.statusText ?? "", body: postResult.body };
    if (routeRegistered) await page.unroute(streamPattern, routeHandler);
  } else if (postResult.contentType.includes("text/event-stream")) {
    // POST returned SSE directly — no need for stream interception
    result = { error: postResult.error, status: postResult.status, statusText: postResult.statusText ?? "", body: postResult.body };
    if (routeRegistered) await page.unroute(streamPattern, routeHandler);
  } else {
    // POST returned JSON (streamId flow) — the page's JS will GET the stream.
    // Wait for our route interceptor to capture it.
    if (routeRegistered) {
      // Set a timeout in case the page doesn't fetch the stream
      const timeout = new Promise<{ error: boolean; status: number; statusText: string; body: string }>((res) =>
        setTimeout(() => res({ error: true, status: 408, statusText: "timeout", body: "Stream interception timed out — page did not fetch the stream within 30s" }), 30_000)
      );
      result = await Promise.race([sseCapture.promise, timeout]);
      await page.unroute(streamPattern, routeHandler);
    } else {
      // Fallback: try GET ourselves (may fail due to race)
      const fallbackResult = await page.evaluate(
        async ({ apiBase, streamBody, bearerToken, convId }: { apiBase: string; streamBody: string; bearerToken: string; convId: string }) => {
          try {
            const parsed = JSON.parse(streamBody) as { streamId?: string };
            if (!parsed.streamId) return { error: false, status: 200, body: streamBody };
            const sseRes = await fetch(`${apiBase}/agents/chat/stream/${parsed.streamId}`, {
              method: "GET",
              headers: {
                Accept: "text/event-stream",
                Authorization: `Bearer ${bearerToken}`,
                Origin: "https://chat.ai.jh.edu",
                Referer: `https://chat.ai.jh.edu/c/${convId}`,
              },
            });
            if (!sseRes.ok) return { error: true, status: sseRes.status, statusText: sseRes.statusText, body: (await sseRes.text()).slice(0, 2000) };
            const reader = sseRes.body?.getReader();
            if (!reader) return { error: true, status: 500, statusText: "No body", body: "No SSE body" };
            const decoder = new TextDecoder();
            let fullText = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              fullText += decoder.decode(value, { stream: true });
            }
            return { error: false, status: 200, body: fullText };
          } catch (err) {
            return { error: true, status: 500, statusText: "fetch error", body: String(err) };
          }
        },
        { apiBase: JH_API_BASE, streamBody: postResult.body, bearerToken: credentials.bearerToken, convId: conversationId },
      );
      result = { ...fallbackResult, statusText: fallbackResult.statusText ?? "" };
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
