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

  // Strategy: use Playwright's network observation to capture the SSE stream.
  //
  // The JH flow: POST → JSON {streamId} → someone GETs /stream/{id} → SSE
  // The page's own JS handles the stream GET. We use page.waitForResponse()
  // to observe the actual network response when it happens, then read the body.
  // No polling, no racing — we just listen for the real response.

  type Result = { error: boolean; status: number; statusText: string; body: string };

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

        // If POST returns SSE directly, read it
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
  } else if (postResult.contentType.includes("text/event-stream")) {
    result = { error: false, status: 200, statusText: "OK", body: postResult.body };
  } else {
    // POST returned JSON with streamId
    let streamId: string | undefined;
    try {
      streamId = (JSON.parse(postResult.body) as { streamId?: string }).streamId;
    } catch { /* not JSON */ }

    if (!streamId) {
      result = { error: false, status: 200, statusText: "OK", body: postResult.body };
    } else {
      // Wait for the actual network response to the stream URL.
      // The page's JS will make the GET — we just observe the response.
      try {
        const streamResponse = await page.waitForResponse(
          (resp) => resp.url().includes(`/agents/chat/stream/${streamId}`) && resp.status() === 200,
          { timeout: 120_000 },
        );
        const sseBody = await streamResponse.text();
        result = { error: false, status: 200, statusText: "OK", body: sseBody };
      } catch {
        // Page didn't fetch the stream — try fetching it ourselves via page.evaluate
        const fallback = await page.evaluate(
          async ({ url, token }: { url: string; token: string }) => {
            try {
              const res = await fetch(url, {
                method: "GET",
                headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
              });
              if (!res.ok) return { error: true, status: res.status, statusText: res.statusText, body: (await res.text()).slice(0, 2000) };
              const reader = res.body?.getReader();
              if (!reader) return { error: true, status: 500, statusText: "No body", body: "No SSE body" };
              const decoder = new TextDecoder();
              let text = "";
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                text += decoder.decode(value, { stream: true });
              }
              return { error: false, status: 200, statusText: "OK", body: text };
            } catch (err) {
              return { error: true, status: 500, statusText: "fetch error", body: String(err) };
            }
          },
          { url: `${JH_API_BASE}/agents/chat/stream/${streamId}`, token: credentials.bearerToken },
        );
        result = { ...fallback, statusText: fallback.statusText ?? "" };
      }
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
