import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useAppContext } from "../AppContext.js";

interface ChatMessage {
  role: "user" | "assistant" | "error";
  content: string;
}

export function ChatPanel(): React.ReactElement {
  const { state, navigate } = useAppContext();
  const { gatewayStatus, config, activeModel } = state;
  const gatewayRunning = gatewayStatus === "running";

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastMessage, setLastMessage] = useState<ChatMessage | null>(null);
  const [lastUserInput, setLastUserInput] = useState<string | null>(null);

  const handleSubmit = async (value: string) => {
    if (!gatewayRunning) {
      navigate("gateway");
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || loading) return;

    setLastUserInput(trimmed);
    setLastMessage(null);
    setLoading(true);
    setInput("");

    const port = config.port;
    const apiKey = config.auth.token ?? null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      let response: Response;
      try {
        response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: activeModel,
            messages: [{ role: "user", content: trimmed }],
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        let errMsg = `Error ${response.status}`;
        try {
          const errBody = await response.json() as { error?: { message?: string } };
          if (errBody?.error?.message) errMsg += `: ${errBody.error.message}`;
        } catch { /* ignore */ }
        setLastMessage({ role: "error", content: errMsg });
        return;
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
      const content = data?.choices?.[0]?.message?.content ?? "";
      setLastMessage({ role: "assistant", content });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setLastMessage({ role: "error", content: "Request timed out" });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setLastMessage({ role: "error", content: `Connection failed: ${msg}` });
      }
    } finally {
      setLoading(false);
    }
  };

  useInput((_input, key) => {
    if (!gatewayRunning) {
      if (key.return) navigate("gateway");
      else if (_input === "b" || key.escape) navigate("menu");
      return;
    }

    if (key.escape) {
      if (!loading) navigate("menu");
      return;
    }

    if (key.return) {
      void handleSubmit(input);
      return;
    }

    if (loading) return;

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    if (_input && !key.ctrl && !key.meta) {
      setInput((prev) => prev + _input);
    }
  });

  if (!gatewayRunning) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold>Chat</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color="yellow">Gateway is not running. Press Enter to start it.</Text>
        </Box>
        <Box>
          <Text dimColor>[b/Esc] Back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Chat</Text>
        <Text dimColor>  Model: {activeModel}</Text>
      </Box>

      {/* Response area */}
      <Box flexDirection="column" marginBottom={1} minHeight={6}>
        {lastUserInput && (
          <Box marginBottom={1}>
            <Text color="cyan">You: {lastUserInput}</Text>
          </Box>
        )}
        {loading && (
          <Box>
            <Text color="yellow">Thinking…</Text>
          </Box>
        )}
        {!loading && lastMessage?.role === "assistant" && (
          <Box>
            <Text color="green">Assistant: {lastMessage.content}</Text>
          </Box>
        )}
        {!loading && lastMessage?.role === "error" && (
          <Box>
            <Text color="red">{lastMessage.content}</Text>
          </Box>
        )}
      </Box>

      {/* Input area */}
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text>
          {input.length > 0 ? input : <Text dimColor>Type a message and press Enter…</Text>}
          <Text color="cyan">█</Text>
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>[Enter] Send  [b/Esc] Back</Text>
      </Box>
    </Box>
  );
}
