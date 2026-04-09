# jh-web-gateway

Standalone local HTTP server exposing an OpenAI-compatible API backed by the JH web platform (chat.ai.jh.edu). Uses Chrome CDP for credential capture and in-browser fetch for Cloudflare bypass.

## Requirements

- Node.js 22+
- Google Chrome with remote debugging enabled

## Quick Start

```bash
npm install

# Launch Chrome with remote debugging (quit Chrome first if already running)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.jh-gateway/chrome-profile"

# Log into chat.ai.jh.edu in that Chrome window, then:
npm run build
node dist/cli.js setup    # interactive setup wizard
node dist/cli.js serve    # start the gateway
```

## Usage

```bash
# List models
curl http://127.0.0.1:8741/v1/models \
  -H "Authorization: Bearer <your-api-key>"

# Chat completion
curl -X POST http://127.0.0.1:8741/v1/chat/completions \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4.5","messages":[{"role":"user","content":"Hello"}]}'
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `setup` | Interactive setup wizard (Chrome detection, auth, port) |
| `serve` | Start the HTTP server (`--port` to override) |
| `auth`  | Re-capture JH credentials |
| `config`| Print current config (credentials redacted) |
| `status`| Show Chrome connection, token expiry, gateway state |
| `logs`  | Display recent request logs (`--limit N`) |

## Available Models

| Model | Endpoint |
|-------|----------|
| claude-opus-4.5 | AnthropicClaude |
| claude-sonnet-4.5 | AnthropicClaude |
| claude-haiku-4.5 | AnthropicClaude |
| gpt-4.1 | OpenAI |
| o3 | OpenAI |
| o3-mini | OpenAI |
| gpt-5 | OpenAI |
| gpt-5.1 | OpenAI |
| gpt-5.2 | OpenAI |
| llama3-3-70b-instruct | Meta |

## Development

```bash
npm test          # run tests
npm run build     # build with tsup
npm run dev       # build in watch mode
```

## Architecture

```
src/
├── cli.ts              # CLI entry point
├── server.ts           # Hono HTTP server
├── cli/                # CLI commands (setup, serve, auth, config, status, logs)
├── core/               # Business logic
│   ├── client.ts       # Browser-based API client (CDP fetch)
│   ├── auth-capture.ts # Credential capture via request interception
│   ├── message-builder.ts  # OpenAI → JH prompt conversion
│   ├── stream-translator.ts # JH SSE → OpenAI format
│   ├── request-queue.ts    # FIFO serialization queue
│   └── tool-parser.ts     # XML tool_call extraction
├── infra/              # Infrastructure
│   ├── types.ts        # Shared type definitions
│   ├── config.ts       # Config store (~/.jh-gateway/config.json)
│   ├── chrome-cdp.ts   # Chrome CDP connection
│   ├── gateway-auth.ts # Local API key auth middleware
│   └── logger.ts       # JSONL request logging
└── routes/             # HTTP route handlers
    ├── chat-completions.ts
    ├── health.ts
    └── models.ts
```
