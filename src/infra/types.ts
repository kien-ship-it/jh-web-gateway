// Shared type definitions for jh-web-gateway

// ── Credentials & Config ──────────────────────────────────────────────────────

export interface GatewayCredentials {
  bearerToken: string;
  cookie: string;
  userAgent: string;
  /** JWT exp claim (unix seconds), optional for backward compatibility */
  expiresAt?: number;
}

export interface GatewayConfig {
  /** default: "http://127.0.0.1:9222" */
  cdpUrl: string;
  /** default: 8741 */
  port: number;
  /** default: "claude-opus-4.5" */
  defaultModel: string;
  /** default: "AnthropicClaude" */
  defaultEndpoint: string;
  credentials: GatewayCredentials | null;
  auth: {
    mode: "none" | "bearer" | "basic";
    token: string | null;
  };
  /** default: 120000 */
  maxQueueWaitMs: number;
}

// ── OpenAI Wire Types ─────────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  type: "function";
  index?: number;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: object;
  };
}

export interface OpenAIChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: [{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: ToolCallDelta[];
    };
    finish_reason: string | null;
  }];
}

export interface OpenAICompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: [{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    code: string;
    param: string | null;
  };
}

// ── Tool Parsing ──────────────────────────────────────────────────────────────

export interface ParsedToolCall {
  id: string;
  name: string;
  /** valid JSON string */
  arguments: string;
}

export interface ParsedContent {
  /** text outside tags */
  text: string;
  toolCalls: ParsedToolCall[];
  /** extracted think content, stripped from text */
  thinking: string | null;
}

// ── Logging ───────────────────────────────────────────────────────────────────

export interface RequestLogEntry {
  timestamp: string;
  method: string;
  path: string;
  model: string | null;
  statusCode: number;
  latencyMs: number;
  estimatedTokens: {
    prompt: number;
    completion: number;
  };
}

// ── Auth Capture ──────────────────────────────────────────────────────────────

export interface CapturedCredentials {
  bearerToken: string;
  cookie: string;
  userAgent: string;
  /** decoded from JWT exp claim */
  expiresAt: number;
}

// ── Browser Client ────────────────────────────────────────────────────────────

export interface ChatRequest {
  model: string;
  /** flattened from message-builder */
  prompt: string;
  conversationId?: string;
  parentMessageId?: string;
}

export interface ChatResponse {
  rawSseText: string;
  conversationId: string;
  parentMessageId: string;
}

// ── Message Builder ───────────────────────────────────────────────────────────

export interface BuiltPrompt {
  /** flattened conversation text */
  prompt: string;
  /** extracted system message */
  systemPrompt?: string;
}

// ── Model → Endpoint Mapping ──────────────────────────────────────────────────

/** Maps model IDs to JH platform endpoint paths */
export const MODEL_ENDPOINT_MAP: Record<string, string> = {
  "claude-opus-4.5": "AnthropicClaude",
  "claude-sonnet-4.5": "AnthropicClaude",
  "claude-haiku-4.5": "AnthropicClaude",
  "gpt-4.1": "OpenAI",
  "o3": "OpenAI",
  "o3-mini": "OpenAI",
  "gpt-5": "OpenAI",
  "gpt-5.1": "OpenAI",
  "gpt-5.2": "OpenAI",
  "llama3-3-70b-instruct": "Meta",
} as const;
