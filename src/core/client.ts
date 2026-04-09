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

  // Use the existing authenticated JH page directly for fetch calls.
  // This ensures cookies, Cloudflare clearance, and session state are all present.
  const result = await page.evaluate(
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
        // POST to start the chat — accept SSE directly from the response.
        // The JH platform returns text/event-stream from the POST itself.
        // Browser sends cookies automatically (same-origin); we only need to set
        // the Authorization header explicitly since it's not a cookie.
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
          };
        }

        const contentType = res.headers.get("content-type") ?? "";

        // If the response is SSE, read the stream directly
        if (contentType.includes("text/event-stream")) {
          const reader = res.body?.getReader();
          if (!reader) {
            return { error: true, status: 500, statusText: "No body", body: "No SSE response body" };
          }
          const decoder = new TextDecoder();
          let fullText = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullText += decoder.decode(value, { stream: true });
          }
          return { error: false, status: 200, body: fullText };
        }

        // If the response is JSON (streamId flow), follow up with GET
        const startJson = await res.json() as { streamId?: string };
        const streamId = startJson.streamId;
        if (!streamId) {
          return { error: false, status: 200, body: JSON.stringify(startJson) };
        }

        const sseRes = await fetch(`${apiBase}/agents/chat/stream/${streamId}`, {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${bearerToken}`,
            Origin: "https://chat.ai.jh.edu",
            Referer: `https://chat.ai.jh.edu/c/${requestBody.conversationId as string}`,
          },
        });

        if (!sseRes.ok) {
          return {
            error: true,
            status: sseRes.status,
            statusText: sseRes.statusText,
            body: (await sseRes.text()).slice(0, 2000),
          };
        }

        const reader = sseRes.body?.getReader();
        if (!reader) {
          return { error: true, status: 500, statusText: "No body", body: "No SSE response body" };
        }
        const decoder = new TextDecoder();
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
        }
        return { error: false, status: 200, body: fullText };
      } catch (err) {
        const msg = String(err);
        if (msg.includes("aborted") || msg.includes("signal")) {
          return { error: true, status: 408, statusText: "timeout", body: "Request timed out after 300s" };
        }
        return { error: true, status: 500, statusText: "fetch error", body: msg };
      }
    },
    {
      apiBase: JH_API_BASE,
      bearerToken: credentials.bearerToken,
      endpointPath: endpoint,
      requestBody: body as unknown as Record<string, unknown>,
    },
  );

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
