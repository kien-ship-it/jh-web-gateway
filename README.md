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

## Interactive TUI

Run without arguments (or with `tui`) to open the full-screen interactive terminal UI:

```bash
jh-gateway
# or
jh-gateway tui
```

The TUI guides you through the complete workflow — start the gateway, pick a model, send test messages, and copy connection details — all without leaving the terminal.

---

### Splash Screen

On launch, an animated ASCII banner plays. Press any key to skip it and enter the main menu.

```text
     ██╗██╗  ██╗    ██╗    ██╗███████╗██████╗
     ██║██║  ██║    ██║    ██║██╔════╝██╔══██╗
     ██║███████║    ██║ █╗ ██║█████╗  ██████╔╝
██   ██║██╔══██║    ██║███╗██║██╔══╝  ██╔══██╗
╚█████╔╝██║  ██║    ╚███╔███╔╝███████╗██████╔╝
 ╚════╝ ╚═╝  ╚═╝     ╚══╝╚══╝ ╚══════╝╚═════╝

      ██████╗  █████╗ ████████╗███████╗██╗    ██╗ █████╗ ██╗   ██╗
     ██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝██║    ██║██╔══██╗╚██╗ ██╔╝
     ██║  ███╗███████║   ██║   █████╗  ██║ █╗ ██║███████║ ╚████╔╝
     ██║   ██║██╔══██║   ██║   ██╔══╝  ██║███╗██║██╔══██║  ╚██╔╝
     ╚██████╔╝██║  ██║   ██║   ███████╗╚███╔███╔╝██║  ██║   ██║
      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝

      Infinite tokens, for school work of course :)))
      Press any key to continue
```

---

### Main Menu

The header shows the gateway status at all times. Use arrow keys to navigate and `Enter` to select.

```text
┌─────────────────────────────────────────────────────────────┐
│ jh-gateway                         ● Gateway: stopped       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Main Menu                                                  │
│                                                             │
│  > Start Gateway                                            │
│    Model                                                    │
│    Chat                                                     │
│    Server Info                                              │
│    Settings                                                 │
│    Quit                                                     │
│                                                             │
│  Launch Chrome, authenticate, and start the HTTP server     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ [↑↓] Navigate    [Enter] Select    [q/Esc] Quit            │
└─────────────────────────────────────────────────────────────┘
```

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move between items |
| `Enter` | Open the highlighted panel |
| `q` / `Esc` | Quit jh-gateway |

---

### Gateway Panel

Select **Start Gateway** to launch Chrome, authenticate, and start the server. A live phase tracker shows progress:

```text
┌─────────────────────────────────────────────────────────────┐
│ jh-gateway                         ● Gateway: starting      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Gateway Control                                            │
│                                                             │
│  Starting gateway…                                          │
│                                                             │
│  ● Connecting to Chrome                                     │
│  ◌ Waiting for login          ← active phase               │
│  ○ Starting server                                          │
│                                                             │
│ ╭──────────────────────────────────────────╮               │
│ │  Please log in via the Chrome window     │               │
│ ╰──────────────────────────────────────────╯               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Once all phases complete the gateway is live:

```text
┌─────────────────────────────────────────────────────────────┐
│ jh-gateway                         ● Gateway: running       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Gateway Control                                            │
│                                                             │
│  ● Running    [Enter] Stop                                  │
│                                                             │
│  ● Connecting to Chrome                                     │
│  ● Waiting for login                                        │
│  ● Starting server                                          │
│                                                             │
│  Gateway running on http://127.0.0.1:8741                  │
│                                                             │
│  [b/Esc] Back (gateway keeps running)                      │
└─────────────────────────────────────────────────────────────┘
```

| Symbol | Meaning |
|--------|---------|
| `○` | Pending |
| `◌` | Active (in progress) |
| `●` | Done |
| `✗` | Error |

| Key | Action |
|-----|--------|
| `Enter` | Start / Stop the gateway |
| `b` / `Esc` | Back to menu (gateway continues running in the background) |

---

### Model Selector

Choose the AI model for all requests. The currently active model is marked with a filled circle (`●`).

```text
┌─────────────────────────────────────────────────────────────┐
│ jh-gateway                         ● Gateway: running       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Select Model                                               │
│                                                             │
│  > ● claude-opus-4.5          ← active model               │
│    ○ claude-sonnet-4.5                                      │
│    ○ claude-haiku-4.5                                       │
│    ○ gpt-4.1                                                │
│    ○ gpt-5                                                  │
│    ○ gpt-5.1                                                │
│    ○ o3                                                     │
│    ○ o3-mini                                                │
│    ○ llama3-3-70b-instruct                                  │
│                                                             │
│  [↑↓] Navigate  [Enter] Select  [b/Esc] Back               │
└─────────────────────────────────────────────────────────────┘
```

The selection is saved to `~/.jh-gateway/config.json` as `defaultModel` immediately on press.

---

### Chat Panel

Send a quick test message from inside the TUI — no external tool required. The panel shows the last exchange and streams a response from the running gateway.

```text
┌─────────────────────────────────────────────────────────────┐
│ jh-gateway                         ● Gateway: running       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Chat  Model: claude-opus-4.5                               │
│                                                             │
│  You: Explain quicksort                                     │
│                                                             │
│  Assistant: Quicksort is a divide-and-conquer algorithm…   │
│                                                             │
│ ╭─────────────────────────────────────────────────────╮    │
│ │  Type a message and press Enter… █                  │    │
│ ╰─────────────────────────────────────────────────────╯    │
│                                                             │
│  [Enter] Send  [b/Esc] Back                                │
└─────────────────────────────────────────────────────────────┘
```

> If the gateway is not yet running, the panel will prompt you to start it first.

| Key | Action |
|-----|--------|
| Type | Compose your message |
| `Enter` | Send the message |
| `Backspace` | Delete last character |
| `b` / `Esc` | Back to menu |

---

### Server Info Panel

Displays the live base URL and API key. Use one-key shortcuts to copy them directly to the clipboard.

```text
┌─────────────────────────────────────────────────────────────┐
│ jh-gateway                         ● Gateway: running       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Server Info                                                │
│                                                             │
│ ╭───────────────────────────────────────────────────╮      │
│ │  Base URL:  http://127.0.0.1:8741                 │      │
│ │  API Key:   jh-local-xxxxxxxxxxxxxxxxxxxxxxxx     │      │
│ ╰───────────────────────────────────────────────────╯      │
│                                                             │
│  Copied URL!                                                │
│                                                             │
│  [c] Copy URL    [k] Copy Key    [b/Esc] Back              │
└─────────────────────────────────────────────────────────────┘
```

| Key | Action |
|-----|--------|
| `c` | Copy base URL to clipboard |
| `k` | Copy API key to clipboard |
| `b` / `Esc` | Back to menu |

---

### Settings Panel

Edit gateway configuration inline — no config file edits needed. Navigate to a field and press `Enter` to edit; `Enter` again to confirm, `Esc` to cancel.

```text
┌─────────────────────────────────────────────────────────────┐
│ jh-gateway                         ● Gateway: running       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Settings                                                   │
│                                                             │
│  > Port:          8741                                      │
│    CDP URL:       http://127.0.0.1:9222                     │
│    Default Model: claude-opus-4.5                           │
│    Auth Mode:     bearer                                    │
│                                                             │
│  [↑↓] Navigate  [Enter] Edit  [b/Esc] Back                 │
└─────────────────────────────────────────────────────────────┘
```

While editing a field the cursor is visible and input is echoed live:

```text
  > Port:  9000█
```

Changes are validated and written to `~/.jh-gateway/config.json` on confirm.

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move between fields |
| `Enter` | Start / confirm editing |
| `Esc` | Cancel editing |
| `b` / `Esc` | Back to menu (when not editing) |

---

### TUI keyboard shortcuts at a glance

| Key | Context | Action |
|-----|---------|--------|
| `↑` / `↓` | Menu, Model, Settings | Navigate items |
| `Enter` | Main Menu | Open selected panel |
| `Enter` | Gateway Panel | Start / Stop gateway |
| `Enter` | Chat | Send message |
| `Enter` | Settings | Begin / confirm editing a field |
| `b` / `Esc` | Any panel | Return to main menu |
| `c` | Server Info | Copy base URL to clipboard |
| `k` | Server Info | Copy API key to clipboard |
| `q` / `Esc` | Main Menu | Quit |
| `Ctrl+C` | Anywhere | Force quit |

---

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
