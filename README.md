# jh-web-gateway

Local HTTP server that exposes an **OpenAI-compatible API** backed by the JH web platform ([chat.ai.jh.edu](https://chat.ai.jh.edu)). It connects to Chrome via CDP, captures your JH session, and proxies requests through the browser — bypassing Cloudflare and using your existing JH credentials.

Use it to plug JH-hosted models (Claude, GPT, Llama) into any tool that speaks the OpenAI protocol: Cursor, Continue, aider, Open Interpreter, custom scripts, etc.

## Requirements

- Node.js 22+
- Google Chrome

## Install

```bash
npm install -g jh-web-gateway
```

Or clone and build locally:

```bash
git clone <repo-url>
cd jh-web-gateway
npm install
npm run build
```

## Getting Started

### 1. Launch Chrome with remote debugging

Quit Chrome if it's already running, then:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.jh-gateway/chrome-profile"

# Linux
google-chrome --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.jh-gateway/chrome-profile"
```

### 2. Log into JH

Open [chat.ai.jh.edu](https://chat.ai.jh.edu) in that Chrome window and sign in.

### 3. Run setup

```bash
jh-gateway setup
```

This walks you through Chrome detection, credential capture, and API key generation.

### 4. Start the gateway

```bash
jh-gateway serve
```

The server starts at `http://127.0.0.1:8741` by default.

## Usage

### curl

```bash
# Health check
curl http://127.0.0.1:8741/health

# List available models
curl http://127.0.0.1:8741/v1/models \
  -H "Authorization: Bearer <your-api-key>"

# Chat completion
curl http://127.0.0.1:8741/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-api-key>" \
  -d '{
    "model": "claude-sonnet-4.5",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Streaming
curl http://127.0.0.1:8741/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-api-key>" \
  -d '{
    "model": "claude-sonnet-4.5",
    "stream": true,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8741/v1",
    api_key="jh-local-..."  # from setup
)

response = client.chat.completions.create(
    model="claude-opus-4.5",
    messages=[{"role": "user", "content": "Explain quicksort"}]
)
print(response.choices[0].message.content)
```

### Node.js (OpenAI SDK)

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:8741/v1",
  apiKey: "jh-local-...",
});

const completion = await client.chat.completions.create({
  model: "claude-sonnet-4.5",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(completion.choices[0].message.content);
```

### Cursor / Continue / Other Tools

Point any OpenAI-compatible tool at:
- Base URL: `http://127.0.0.1:8741/v1`
- API Key: your `jh-local-...` key from setup

## CLI Commands

| Command | Description |
|---------|-------------|
| `jh-gateway setup` | Interactive setup wizard (Chrome detection, auth, port) |
| `jh-gateway serve` | Start the HTTP server |
| `jh-gateway auth` | Re-capture JH credentials |
| `jh-gateway config` | Print current config (credentials redacted) |
| `jh-gateway status` | Show Chrome connection, token expiry, gateway state |
| `jh-gateway logs` | Display recent request logs |

Options:
- `serve --port <n>` — override the configured port
- `logs --limit <n>` — number of log entries to show (default: 50)

## Available Models

| Model | Endpoint |
|-------|----------|
| `claude-opus-4.5` | AnthropicClaude |
| `claude-sonnet-4.5` | AnthropicClaude |
| `claude-haiku-4.5` | AnthropicClaude |
| `gpt-4.1` | OpenAI |
| `gpt-5` | OpenAI |
| `gpt-5.1` | OpenAI |
| `gpt-5.2` | OpenAI |
| `o3` | OpenAI |
| `o3-mini` | OpenAI |
| `llama3-3-70b-instruct` | Meta |

## Configuration

Config is stored at `~/.jh-gateway/config.json`. You can edit it directly or use the CLI:

```json
{
  "cdpUrl": "http://127.0.0.1:9222",
  "port": 8741,
  "defaultModel": "claude-opus-4.5",
  "auth": { "mode": "bearer", "token": "jh-local-..." },
  "maxQueueWaitMs": 120000
}
```

## How It Works

1. Connects to Chrome via CDP (Chrome DevTools Protocol)
2. Captures your JH session credentials from the browser
3. Runs an HTTP server that accepts OpenAI-format requests
4. Proxies requests through the browser's authenticated session
5. Translates JH SSE responses back to OpenAI format

Requests are serialized through a FIFO queue since the JH platform handles one conversation turn at a time.

## Development

```bash
npm test          # run tests
npm run build     # build with tsup
npm run dev       # build in watch mode
```

## Architecture

```
src/
├── cli.ts                  # CLI entry point
├── server.ts               # Hono HTTP server
├── cli/                    # CLI commands
├── core/
│   ├── client.ts           # Browser-based API client (CDP fetch)
│   ├── auth-capture.ts     # Credential capture via request interception
│   ├── message-builder.ts  # OpenAI → JH prompt conversion
│   ├── stream-translator.ts # JH SSE → OpenAI format
│   ├── request-queue.ts    # FIFO serialization queue
│   └── tool-parser.ts      # XML tool_call extraction
├── infra/
│   ├── types.ts            # Shared types + model→endpoint mapping
│   ├── config.ts           # Config store (~/.jh-gateway/config.json)
│   ├── chrome-cdp.ts       # Chrome CDP connection
│   ├── gateway-auth.ts     # Local API key auth middleware
│   └── logger.ts           # JSONL request logging
└── routes/
    ├── chat-completions.ts # POST /v1/chat/completions
    ├── health.ts           # GET /health
    └── models.ts           # GET /v1/models
```
