import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useAppContext } from "../AppContext.js";
import { startGatewayForTui, stopGateway } from "../services/gateway-lifecycle.js";
import type { GatewayPhase } from "../types.js";

const PHASE_LABELS = ["Connecting to Chrome", "Waiting for login", "Starting server"];

function phaseIcon(status: GatewayPhase["status"]): string {
  switch (status) {
    case "pending": return "○";
    case "active":  return "◌";
    case "done":    return "●";
    case "error":   return "✗";
  }
}

function phaseColor(status: GatewayPhase["status"]): string | undefined {
  switch (status) {
    case "done":    return "green";
    case "active":  return "cyan";
    case "error":   return "red";
    default:        return "gray";
  }
}

export function GatewayPanel(): React.ReactElement {
  const { state, navigate, setGatewayStatus, setGatewayError, setServerHandle, setChromeState, setTokenRefresher } = useAppContext();
  const { gatewayStatus, gatewayError, config, serverHandle, chromeState, tokenRefresher } = state;

  const [phases, setPhases] = useState<GatewayPhase[]>([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [authPrompt, setAuthPrompt] = useState(false);

  const handleStart = useCallback(async () => {
    if (starting || stopping) return;
    setStarting(true);
    setGatewayError(null);
    setGatewayStatus("starting");
    setAuthPrompt(false);

    const initial: GatewayPhase[] = PHASE_LABELS.map((label) => ({ label, status: "pending" }));
    setPhases(initial);

    let phaseIndex = 0;

    try {
      const result = await startGatewayForTui(
        config,
        { headless: false },
        {
          onPhase: (phase) => {
            const idx = PHASE_LABELS.indexOf(phase);
            if (idx >= 0) {
              if (phase === "Waiting for login") setAuthPrompt(true);
              else setAuthPrompt(false);
              phaseIndex = idx;
              setPhases((prev) =>
                prev.map((p, i) => {
                  if (i < idx) return { ...p, status: "done" };
                  if (i === idx) return { ...p, status: "active" };
                  return p;
                }),
              );
            }
          },
          onSuccess: ({ baseUrl: _baseUrl, apiKey: _apiKey }) => {
            setAuthPrompt(false);
            setPhases((prev) => prev.map((p) => ({ ...p, status: "done" })));
          },
          onError: (_err) => {
            setPhases((prev) =>
              prev.map((p, i) => {
                if (i === phaseIndex) return { ...p, status: "error" };
                if (i < phaseIndex) return { ...p, status: "done" };
                return p;
              }),
            );
          },
        },
      );
      setServerHandle(result.serverHandle);
      setChromeState(result.chromeState);
      setTokenRefresher(result.tokenRefresher);
      setGatewayStatus("running");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setGatewayError(message);
      setGatewayStatus("error");
    } finally {
      setStarting(false);
    }
  }, [starting, stopping, config, setGatewayStatus, setGatewayError, setServerHandle, setChromeState, setTokenRefresher]);

  const handleStop = useCallback(async () => {
    if (stopping || starting || !serverHandle || !chromeState || !tokenRefresher) return;
    setStopping(true);
    try {
      await stopGateway(serverHandle, chromeState, tokenRefresher);
      setServerHandle(null);
      setChromeState(null);
      setTokenRefresher(null);
      setGatewayStatus("stopped");
      setGatewayError(null);
      setPhases([]);
    } finally {
      setStopping(false);
    }
  }, [stopping, starting, serverHandle, chromeState, tokenRefresher, setGatewayStatus, setGatewayError, setServerHandle, setChromeState, setTokenRefresher]);

  useInput((_input, key) => {
    if (key.return) {
      if (gatewayStatus === "running") {
        void handleStop();
      } else if (gatewayStatus !== "starting") {
        void handleStart();
      }
    } else if (_input === "b" || key.escape) {
      navigate("menu");
    }
  });

  const isRunning = gatewayStatus === "running";
  const isStopped = gatewayStatus === "stopped" || gatewayStatus === "error";

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Gateway Control</Text>
      </Box>

      {/* Action button */}
      <Box marginBottom={1}>
        {starting ? (
          <Text color="cyan">Starting gateway…</Text>
        ) : stopping ? (
          <Text color="yellow">Stopping gateway…</Text>
        ) : isRunning ? (
          <Text>
            <Text color="green">● Running</Text>
            {"  "}
            <Text dimColor>[Enter] Stop</Text>
          </Text>
        ) : (
          <Text>
            <Text color={gatewayStatus === "error" ? "red" : "gray"}>
              ● {gatewayStatus === "error" ? "Error" : "Stopped"}
            </Text>
            {"  "}
            <Text dimColor>[Enter] {gatewayStatus === "error" ? "Retry" : "Start"}</Text>
          </Text>
        )}
      </Box>

      {/* Phase indicators */}
      {phases.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {phases.map((phase) => (
            <Box key={phase.label}>
              <Text color={phaseColor(phase.status)}>
                {phaseIcon(phase.status)} {phase.label}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Auth prompt */}
      {authPrompt && (
        <Box marginBottom={1} borderStyle="round" borderColor="yellow" padding={1}>
          <Text color="yellow">Please log in via the Chrome window</Text>
        </Box>
      )}

      {/* Error message */}
      {gatewayStatus === "error" && gatewayError && (
        <Box marginBottom={1}>
          <Text color="red">Error: {gatewayError}</Text>
        </Box>
      )}

      {/* Connected info */}
      {isRunning && (
        <Box>
          <Text color="green">Gateway running on http://127.0.0.1:{config.port}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        {isStopped && <Text dimColor>[b/Esc] Back to menu</Text>}
        {isRunning && <Text dimColor>[b/Esc] Back (gateway keeps running)</Text>}
      </Box>
    </Box>
  );
}
