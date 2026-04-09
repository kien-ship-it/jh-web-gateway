import React from "react";
import { Box, Text, useInput } from "ink";
import { useAppContext } from "../AppContext.js";
import { stopGateway } from "../services/gateway-lifecycle.js";

interface QuitDialogProps {
  onCancel: () => void;
}

export function QuitDialog({ onCancel }: QuitDialogProps): React.ReactElement {
  const { state } = useAppContext();
  const { gatewayStatus, serverHandle, chromeState, tokenRefresher } = state;

  useInput((input, key) => {
    if (input === "y" || input === "Y") {
      void (async () => {
        if (
          gatewayStatus === "running" &&
          serverHandle &&
          chromeState &&
          tokenRefresher
        ) {
          try {
            await stopGateway(serverHandle, chromeState, tokenRefresher);
          } catch {
            // proceed with exit even if stop fails
          }
        }
        process.exit(0);
      })();
    } else if (input === "n" || input === "N" || key.escape) {
      onCancel();
    }
  });

  return (
    <Box borderStyle="round" borderColor="yellow" padding={1} flexDirection="column">
      <Text bold color="yellow">
        Quit jh-gateway?
      </Text>
      <Box marginTop={1}>
        <Text>Running gateway will be stopped.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[y] Yes  [N/Esc] Cancel</Text>
      </Box>
    </Box>
  );
}
