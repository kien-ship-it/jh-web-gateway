import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useAppContext } from "../AppContext.js";
import { MODEL_ENDPOINT_MAP } from "../../infra/types.js";
import { updateConfig } from "../../infra/config.js";
import { wrapIndex } from "../utils/navigation.js";

const MODELS = Object.keys(MODEL_ENDPOINT_MAP);

interface ChatMessage {
  role: "user" | "assistant" | "error";
  content: string;
}

export function ChatPanel(): React.ReactElement {
  const { state, navigate, setActiveModel } = useAppContext();
  const { gatewayStatus, config, activeModel } = state;
  const gatewayRunning = gatewayStatus === "running";

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastMessage, setLastMessage] = useState<ChatMessage | null>(null);
  const [lastUserInput, setLastUserInput] = useState<string | null>(null);

  // Inline model picker state
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelFocusIndex, setModelFocusIndex] = useState(() => {
    const idx = MODELS.indexOf(activeModel);
    return idx >= 0 ? idx : 0;
  });
  const [confirmationModel, setConfirmationModel] = useState<string | null>(null);

  // Blinking cursor
  const [cursorVisible, setCursorVisible] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (confirmationModel !== null) {
      const timer = setTimeout(() => setConfirmationModel(null), 1500);
      return () => clearTimeout(timer);
    }
  }, [confirmationModel]);

  // Sync focus index when picker opens
  useEffect(() => {
    if (showModelPicker) {
      const idx = MODELS.indexOf(activeModel);
      setModelFocusIndex(idx >= 0 ? idx : 0);
    }
  }, [showModelPicker, activeModel]);

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
    // ── Model picker mode ──────────────────────────────────────────────────
    if (showModelPicker) {
      if (key.downArrow) {
        setModelFocusIndex((i) => wrapIndex(i, 1, MODELS.length));
      } else if (key.upArrow) {
        setModelFocusIndex((i) => wrapIndex(i, -1, MODELS.length));
      } else if (key.return) {
        const selected = MODELS[modelFocusIndex];
        updateConfig({ defaultModel: selected }).catch(() => { });
        setActiveModel(selected);
        setConfirmationModel(selected);
        setShowModelPicker(false);
      } else if (key.escape) {
        setShowModelPicker(false);
      }
      return;
    }

    // ── Normal chat mode ───────────────────────────────────────────────────
    if (!gatewayRunning) {
      if (key.return) navigate("gateway");
      else if (_input === "b" || key.escape) navigate("menu");
      return;
    }

    if (key.escape) {
      if (!loading) navigate("menu");
      return;
    }

    // Arrow keys open the model picker
    if ((key.upArrow || key.downArrow) && !loading) {
      setShowModelPicker(true);
      // Also move in the direction pressed
      if (key.upArrow) {
        setModelFocusIndex((i) => wrapIndex(i, -1, MODELS.length));
      } else {
        setModelFocusIndex((i) => wrapIndex(i, 1, MODELS.length));
      }
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
      {/* Header with model indicator */}
      <Box marginBottom={1}>
        <Text bold>Chat</Text>
        <Text dimColor>  Model: </Text>
        <Text color="green">{activeModel}</Text>
        {confirmationModel !== null && (
          <Text color="green">  ✓ Switched!</Text>
        )}
        {!showModelPicker && (
          <Text dimColor>  [↑↓] change</Text>
        )}
      </Box>

      {/* Inline model picker overlay */}
      {showModelPicker && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">Select Model</Text>
            <Text dimColor>  [↑↓] Navigate  [Enter] Select  [Esc] Cancel</Text>
          </Box>
          {MODELS.map((model, index) => {
            const isFocused = index === modelFocusIndex;
            const isActive = model === activeModel;
            return (
              <Box key={model}>
                <Text color={isFocused ? "cyan" : undefined} bold={isFocused}>
                  {isFocused ? "> " : "  "}
                  <Text color={isActive ? "green" : "gray"}>{isActive ? "●" : "○"}</Text>
                  {" "}
                  {model}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Response area */}
      {!showModelPicker && (
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
      )}

      {/* Input area */}
      {!showModelPicker && (
        <>
          <Box borderStyle="round" borderColor="gray" paddingX={1}>
            <Text>
              {input.length > 0
                ? <>{input}<Text color="cyan">{cursorVisible ? "█" : " "}</Text></>
                : <><Text color="cyan">{cursorVisible ? "█" : " "}</Text><Text dimColor>Type a message and press Enter…</Text></>
              }
            </Text>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>[Enter] Send  [↑↓] Model  [Esc] Back</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
