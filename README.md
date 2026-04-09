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

## Getting Started

### First run — log in once

```bash
jh-gateway start
```

This launches Chrome, opens [chat.ai.jh.edu](https://chat.ai.jh.edu), and waits for you to sign in. Once you do, it captures your credentials, minimizes Chrome, and starts the gateway server. Your credentials are saved to `~/.jh-gateway/config.json` for future runs.

### Subsequent runs — headless

```bash
jh-gateway start --headless
```

No browser window. Credentials are loaded from the config, and a background token refresher keeps them alive automatically. If the session ever expires, run `jh-gateway start` (without `--headless`) to re-login.

### Connect your tools

Point any OpenAI-compatible tool at:
- Base URL: `http://127.0.0.1:8741/v1`
- API Key: printed at startup as `API Key: jh-local-...`

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
    api_key="jh-local-..."  # printed at startup
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
- API Key: your `jh-local-...` key from startup

## CLI Reference

| Command | Description |
|---------|-------------|
| `jh-gateway start` | Launch Chrome, authenticate, and start the gateway |
| `jh-gateway setup` | Interactive setup wizard (legacy) |
| `jh-gateway serve` | Start the HTTP server only (legacy) |
| `jh-gateway auth` | Re-capture JH credentials manually |
| `jh-gateway config` | Print current config (credentials redacted) |
| `jh-gateway status` | Show Chrome connection, token expiry, gateway state |
| `jh-gateway logs` | Display recent request logs |

### `start` options

| Flag | Description |
|------|-------------|
| `--headless` | Launch Chrome without a visible window (requires prior login) |
| `--port <n>` | Override the configured port |
| `--pages <n>` | Max concurrent browser pages (default: 3) |

## Token Refresh

While the gateway is running, a background process checks your token every 60 seconds. If it's within 5 minutes of expiry, it silently reloads the JH page in Chrome and captures a fresh token — no interruption to in-flight requests. If refresh fails after 3 retries, a warning is printed to the terminal.

## Available Models

| Model | Provider |
|-------|----------|
| `claude-opus-4.5` | Anthropic |
| `claude-sonnet-4.5` | Anthropic |
| `claude-haiku-4.5` | Anthropic |
| `gpt-4.1` | OpenAI |
| `gpt-5` | OpenAI |
| `gpt-5.1` | OpenAI |
| `gpt-5.2` | OpenAI |
| `o3` | OpenAI |
| `o3-mini` | OpenAI |
| `llama3-3-70b-instruct` | Meta |

## Configuration

Config is stored at `~/.jh-gateway/config.json`. Edit directly or use the CLI:

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
6. Proactively refreshes tokens before they expire

## Development

```bash
npm test          # run tests
npm run build     # build with tsup
npm run dev       # build in watch mode
```
