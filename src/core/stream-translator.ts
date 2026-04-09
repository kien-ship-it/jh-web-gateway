import { randomBytes } from "node:crypto";
import type { OpenAIChunk, OpenAICompletion } from "../infra/types.js";
import { parseToolsAndThinking, toOpenAIToolCalls } from "./tool-parser.js";

// ── SSE Parsing ───────────────────────────────────────────────────────────────

interface SseEvent {
  event: string;
  data: string;
}

/** Parse raw SSE text into individual events. */
function parseSseEvents(rawSse: string): SseEvent[] {
  const events: SseEvent[] = [];
  const blocks = rawSse.split("\n\n");

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    let event = "";
    let data = "";

    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event: ")) {
        event = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        data = line.slice(6);
      } else if (line.startsWith("data:")) {
        data = line.slice(5);
      }
    }

    if (event || data) {
      events.push({ event, data });
    }
  }

  return events;
}

/**
 * Resolve the effective event type from a JH SSE event.
 *
 * JH wraps all events in `event: message` and puts the real type
 * in the JSON payload's `event` field. We also support the flat format
 * (event: on_message_delta) for test compatibility.
 */
function resolveEventType(ev: SseEvent): { type: string; parsed: Record<string, unknown> | null } {
  // Flat format: event line already has the real type
  if (ev.event && ev.event !== "message") {
    try {
      return { type: ev.event, parsed: JSON.parse(ev.data) };
    } catch {
      return { type: ev.event, parsed: null };
    }
  }

  // JH wrapped format: event: message, real type in JSON .event field
  if (ev.data) {
    try {
      const parsed = JSON.parse(ev.data) as Record<string, unknown>;
      const jsonEvent = typeof parsed.event === "string" ? parsed.event : null;
      return { type: jsonEvent ?? ev.event, parsed };
    } catch {
      return { type: ev.event, parsed: null };
    }
  }

  return { type: ev.event, parsed: null };
}

/** Check if an event is a user echo (skip). */
function isUserEcho(parsed: Record<string, unknown> | null): boolean {
  if (!parsed) return false;
  // Direct format: { isCreatedByUser: true }
  if (parsed.isCreatedByUser === true) return true;
  // Nested format: { message: { isCreatedByUser: true } }
  const msg = parsed.message as Record<string, unknown> | undefined;
  if (msg?.isCreatedByUser === true || msg?.sender === "User") return true;
  return false;
}

/**
 * Extract text delta from an on_message_delta event payload.
 * Supports both flat format (delta at top level) and nested format (inside .data).
 */
function extractDeltaText(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) return null;

  // Try flat format: { delta: { content: [...] } }
  let content = (parsed.delta as Record<string, unknown>)?.content;

  // Try nested format: { data: { delta: { content: [...] } } }
  if (!content) {
    const dataObj = parsed.data as Record<string, unknown> | undefined;
    content = (dataObj?.delta as Record<string, unknown>)?.content;
  }

  if (!Array.isArray(content)) return null;

  const texts: string[] = [];
  for (const item of content) {
    if (item?.type === "text" && typeof item.text === "string") {
      texts.push(item.text);
    }
  }
  return texts.length > 0 ? texts.join("") : null;
}

/**
 * Extract accumulated text from a final message event.
 * JH sends { message: { text: "full accumulated text", isCreatedByUser: false } }
 */
function extractMessageText(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) return null;
  const msg = parsed.message as Record<string, unknown> | undefined;
  if (!msg) return null;
  if (msg.isCreatedByUser === true || msg.sender === "User") return null;
  if (typeof msg.text === "string" && msg.text) return msg.text;
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Generate a unique completion ID. */
function generateCompletionId(): string {
  return `chatcmpl-${randomBytes(12).toString("hex")}`;
}
/**
 * Extract text content directly from JH SSE events.
 * Supports both flat SSE format and JH's wrapped format.
 */
export function extractContentFromJhSse(rawSse: string): string {
  const events = parseSseEvents(rawSse);
  const parts: string[] = [];
  let lastMessageText = "";

  for (const ev of events) {
    const { type, parsed } = resolveEventType(ev);
    if (isUserEcho(parsed)) continue;
    if (type === "on_run_step") continue;

    if (type === "on_message_delta") {
      const delta = extractDeltaText(parsed);
      if (delta !== null) {
        parts.push(delta);
      }
    }

    // Also handle final message events with accumulated text
    if (type === "message" || !type) {
      const msgText = extractMessageText(parsed);
      if (msgText && msgText.length > lastMessageText.length) {
        lastMessageText = msgText;
      }
    }
  }

  // If we got deltas, use those. Otherwise fall back to accumulated message text.
  const deltaText = parts.join("");
  return deltaText || lastMessageText;
}

/**
 * Parse JH SSE text and return OpenAI SSE chunks.
 * Skips user echoes and metadata events.
 */
export function translateToStream(
  rawSse: string,
  model: string,
  completionId?: string,
): OpenAIChunk[] {
  const id = completionId ?? generateCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const events = parseSseEvents(rawSse);
  const chunks: OpenAIChunk[] = [];
  let lastMessageText = "";

  // First chunk: role announcement
  chunks.push({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  });

  let gotDeltas = false;

  for (const ev of events) {
    const { type, parsed } = resolveEventType(ev);
    if (isUserEcho(parsed)) continue;
    if (type === "on_run_step") continue;

    if (type === "on_message_delta") {
      const delta = extractDeltaText(parsed);
      if (delta !== null) {
        gotDeltas = true;
        chunks.push({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
        });
      }
    }

    // Track accumulated message text as fallback
    if (type === "message" || !type) {
      const msgText = extractMessageText(parsed);
      if (msgText && msgText.length > lastMessageText.length) {
        const delta = msgText.slice(lastMessageText.length);
        lastMessageText = msgText;
        if (!gotDeltas && delta) {
          chunks.push({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
          });
        }
      }
    }
  }

  // Final chunk: finish_reason stop
  chunks.push({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });

  return chunks;
}

/**
 * Parse JH SSE text and return a single OpenAI completion JSON.
 * Collects full response text, parses tool calls, estimates token usage.
 */
export function translateToCompletion(
  rawSse: string,
  model: string,
  completionId?: string,
): OpenAICompletion {
  const id = completionId ?? generateCompletionId();
  const created = Math.floor(Date.now() / 1000);

  const fullText = extractContentFromJhSse(rawSse);
  const parsed = parseToolsAndThinking(fullText);

  // Approximate token estimates (1 token ≈ 4 chars)
  const promptTokens = 0;
  const completionTokens = Math.max(1, Math.ceil(fullText.length / 4));

  const message: OpenAICompletion["choices"][0]["message"] = {
    role: "assistant",
    content: parsed.text || null,
  };

  if (parsed.toolCalls.length > 0) {
    message.tool_calls = toOpenAIToolCalls(parsed.toolCalls);
  }

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{ index: 0, message, finish_reason: "stop" }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}
