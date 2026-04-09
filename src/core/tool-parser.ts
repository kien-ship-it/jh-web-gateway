import type { ParsedToolCall, ParsedContent, ToolCall } from "../infra/types.js";

// ── Regex patterns ────────────────────────────────────────────────────────────

const TOOL_CALL_RE =
  /<tool_call\s+id="([^"]*)"\s+name="([^"]*)">([\s\S]*?)<\/tool_call>/g;

const THINK_RE = /<think>([\s\S]*?)<\/think>/g;

// Detects an opening <tool_call that never closes — used for malformed detection
const PARTIAL_TOOL_CALL_RE = /<tool_call\b[^>]*>(?:(?!<\/tool_call>)[\s\S])*$/;

/**
 * Parse response text, extracting `<tool_call>` and `<think>` tags.
 * Malformed XML is emitted as raw text (never throws).
 */
export function parseToolsAndThinking(text: string): ParsedContent {
  const toolCalls: ParsedToolCall[] = [];
  let thinking: string | null = null;

  // Extract think tags first, accumulate thinking content
  const thinkMatches = [...text.matchAll(THINK_RE)];
  if (thinkMatches.length > 0) {
    thinking = thinkMatches.map((m) => m[1]).join("\n");
  }

  // Remove think tags from text for further processing
  let remaining = text.replace(THINK_RE, "");

  // Extract well-formed tool_call tags
  const toolMatches = [...remaining.matchAll(TOOL_CALL_RE)];
  for (const match of toolMatches) {
    const id = match[1];
    const name = match[2];
    const rawArgs = match[3].trim();

    // Validate JSON arguments; if invalid, keep as-is (still valid JSON string)
    let args: string;
    try {
      JSON.parse(rawArgs);
      args = rawArgs;
    } catch {
      // Malformed JSON in arguments — wrap as string to keep valid JSON
      args = JSON.stringify(rawArgs);
    }

    toolCalls.push({ id, name, arguments: args });
  }

  // Remove well-formed tool_call tags from remaining text
  remaining = remaining.replace(TOOL_CALL_RE, "");

  // Any leftover partial/malformed <tool_call> tags stay as raw text
  const cleanedText = remaining.trim();

  return {
    text: cleanedText,
    toolCalls,
    thinking,
  };
}

/**
 * Convert ParsedToolCall[] to OpenAI tool_calls format with incrementing index.
 */
export function toOpenAIToolCalls(calls: ParsedToolCall[]): ToolCall[] {
  return calls.map((call, index) => ({
    id: call.id,
    type: "function" as const,
    index,
    function: {
      name: call.name,
      arguments: call.arguments,
    },
  }));
}

/**
 * Reconstruct XML from parsed tool calls (for round-trip testing).
 */
export function toToolCallXml(calls: ParsedToolCall[]): string {
  return calls
    .map((c) => `<tool_call id="${c.id}" name="${c.name}">${c.arguments}</tool_call>`)
    .join("");
}

// ── Streaming buffer support ──────────────────────────────────────────────────

/**
 * Streaming XML buffer that holds partial `<tool_call>` content until a
 * complete closing tag boundary is found.
 *
 * Feed chunks via `push()`. Completed tool calls are returned; any buffered
 * partial content is held until the closing tag arrives.
 */
export class StreamingToolBuffer {
  private buffer = "";

  /**
   * Push a text chunk. Returns an object with:
   * - `text`: safe-to-emit text (outside any partial tag)
   * - `completedCalls`: fully parsed tool calls from this chunk
   */
  push(chunk: string): { text: string; completedCalls: ParsedToolCall[] } {
    this.buffer += chunk;

    const completedCalls: ParsedToolCall[] = [];
    let safeText = "";

    // Extract all complete tool_call tags
    let match: RegExpExecArray | null;
    const re = new RegExp(TOOL_CALL_RE.source, "g");

    let lastIndex = 0;
    while ((match = re.exec(this.buffer)) !== null) {
      // Text before this match is safe to emit
      safeText += this.buffer.slice(lastIndex, match.index);

      const id = match[1];
      const name = match[2];
      const rawArgs = match[3].trim();

      let args: string;
      try {
        JSON.parse(rawArgs);
        args = rawArgs;
      } catch {
        args = JSON.stringify(rawArgs);
      }

      completedCalls.push({ id, name, arguments: args });
      lastIndex = match.index + match[0].length;
    }

    // Remaining buffer after all complete matches
    const remainder = this.buffer.slice(lastIndex);

    // Check if remainder contains a partial opening tag
    if (PARTIAL_TOOL_CALL_RE.test(remainder)) {
      // Hold the partial tag in the buffer; emit text before it
      const partialStart = remainder.search(/<tool_call\b/);
      if (partialStart > 0) {
        safeText += remainder.slice(0, partialStart);
      }
      this.buffer = partialStart >= 0 ? remainder.slice(partialStart) : remainder;
    } else {
      // No partial tag — emit everything, clear buffer
      safeText += remainder;
      this.buffer = "";
    }

    return { text: safeText, completedCalls };
  }

  /** Flush any remaining buffer content as raw text (end of stream). */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = "";
    return remaining;
  }
}
