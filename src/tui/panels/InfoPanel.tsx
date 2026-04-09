import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useAppContext } from "../AppContext.js";
import { copyToClipboard } from "../utils/clipboard.js";

export function InfoPanel(): React.ReactElement {
  const { state, navigate } = useAppContext();
  const { gatewayStatus, config } = state;
  const gatewayRunning = gatewayStatus === "running";

  const port = config.port;
  const apiKey = config.auth.token ?? null;
  const baseUrl = `http://127.0.0.1:${port}`;

  const [flash, setFlash] = useState<string | null>(null);
  const [clipboardFailed, setClipboardFailed] = useState<{ url?: boolean; key?: boolean }>({});

  useEffect(() => {
    if (flash !== null) {
      const timer = setTimeout(() => setFlash(null), 1500);
      return () => clearTimeout(timer);
    }
  }, [flash]);

  useInput((_input, key) => {
    if (_input === "c") {
      copyToClipboard(baseUrl).then((ok) => {
        if (ok) {
          setFlash("Copied URL!");
          setClipboardFailed((prev) => ({ ...prev, url: false }));
        } else {
          setFlash("Clipboard unavailable");
          setClipboardFailed((prev) => ({ ...prev, url: true }));
        }
      }).catch(() => {
        setFlash("Clipboard unavailable");
        setClipboardFailed((prev) => ({ ...prev, url: true }));
      });
      return;
    }

    if (_input === "k") {
      if (!apiKey) return;
      copyToClipboard(apiKey).then((ok) => {
        if (ok) {
          setFlash("Copied API key!");
          setClipboardFailed((prev) => ({ ...prev, key: false }));
        } else {
          setFlash("Clipboard unavailable");
          setClipboardFailed((prev) => ({ ...prev, key: true }));
        }
      }).catch(() => {
        setFlash("Clipboard unavailable");
        setClipboardFailed((prev) => ({ ...prev, key: true }));
      });
      return;
    }

    if (_input === "b" || key.escape) {
      navigate("menu");
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Server Info</Text>
      </Box>

      {!gatewayRunning && (
        <Box marginBottom={1}>
          <Text color="red">● Gateway not running</Text>
        </Box>
      )}

      <Box borderStyle="round" borderColor={gatewayRunning ? "green" : "gray"} padding={1} flexDirection="column" marginBottom={1}>
        <Box marginBottom={1}>
          <Text bold>Base URL: </Text>
          <Text color={gatewayRunning ? "green" : "gray"}>{baseUrl}</Text>
        </Box>
        {clipboardFailed.url && (
          <Box marginBottom={1}>
            <Box borderStyle="single" borderColor="yellow" paddingX={1}>
              <Text color="yellow">{baseUrl}</Text>
            </Box>
          </Box>
        )}
        <Box>
          <Text bold>API Key:  </Text>
          {apiKey ? (
            <Text color={gatewayRunning ? "cyan" : "gray"}>{apiKey}</Text>
          ) : (
            <Text dimColor>no auth</Text>
          )}
        </Box>
        {clipboardFailed.key && apiKey && (
          <Box marginTop={1}>
            <Box borderStyle="single" borderColor="yellow" paddingX={1}>
              <Text color="yellow">{apiKey}</Text>
            </Box>
          </Box>
        )}
      </Box>

      {flash && (
        <Box marginBottom={1}>
          <Text color={flash.startsWith("Copied") ? "green" : "yellow"}>{flash}</Text>
        </Box>
      )}

      <Box>
        <Text dimColor>[c] Copy URL  {apiKey ? "[k] Copy Key  " : ""}[b/Esc] Back</Text>
      </Box>
    </Box>
  );
}
