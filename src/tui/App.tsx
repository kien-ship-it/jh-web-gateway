import React, { useState, useRef, useEffect } from "react";
import { Box, useInput } from "ink";
import { AppProvider, useAppContext } from "./AppContext.js";
import { HeaderBar } from "./components/HeaderBar.js";
import { FooterBar } from "./components/FooterBar.js";
import { QuitDialog } from "./components/QuitDialog.js";
import { PANEL_SHORTCUTS } from "./utils/shortcuts.js";
import { SplashScreen } from "./panels/SplashScreen.js";
import { MainMenu } from "./panels/MainMenu.js";
import { GatewayPanel } from "./panels/GatewayPanel.js";
import { ModelSelector } from "./panels/ModelSelector.js";
import { ChatPanel } from "./panels/ChatPanel.js";
import { InfoPanel } from "./panels/InfoPanel.js";
import { SettingsPanel } from "./panels/SettingsPanel.js";
import { stopGateway } from "./services/gateway-lifecycle.js";

// ── Types ──────────────────────────────────────────────────────────────────────

interface AppProps {
  onRegisterShutdown?: (fn: () => Promise<void>) => void;
}

// ── Inner component (inside AppProvider) ──────────────────────────────────────

function AppContent({ onRegisterShutdown }: AppProps): React.ReactElement {
  const { state, navigate, setActiveModel } = useAppContext();
  const { currentPanel, gatewayStatus, activeModel } = state;

  const [showQuit, setShowQuit] = useState(false);

  // Keep a ref to the latest state so the shutdown closure always sees fresh values
  const latestStateRef = useRef(state);
  useEffect(() => {
    latestStateRef.current = state;
  });

  // Register the shutdown function once on mount
  useEffect(() => {
    if (onRegisterShutdown) {
      onRegisterShutdown(async () => {
        const { gatewayStatus: status, serverHandle, chromeState, tokenRefresher } =
          latestStateRef.current;
        if (status === "running" && serverHandle && chromeState && tokenRefresher) {
          await stopGateway(serverHandle, chromeState, tokenRefresher);
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global q handler — active only when the quit dialog is not already showing
  // and not on the splash screen
  useInput(
    (input) => {
      if (input === "q" && currentPanel !== "splash") {
        setShowQuit(true);
      }
    },
    { isActive: !showQuit },
  );

  // ── Panel router ─────────────────────────────────────────────────────────────

  const renderPanel = (): React.ReactElement => {
    switch (currentPanel) {
      case "splash":
        return <SplashScreen onComplete={() => navigate("menu")} />;
      case "menu":
        return <MainMenu onQuit={() => setShowQuit(true)} />;
      case "gateway":
        return <GatewayPanel />;
      case "model":
        return (
          <ModelSelector
            activeModel={activeModel}
            onSelect={(model) => setActiveModel(model)}
            onBack={() => navigate("menu")}
          />
        );
      case "chat":
        return <ChatPanel />;
      case "info":
        return <InfoPanel />;
      case "settings":
        return <SettingsPanel />;
    }
  };

  // ── Layout ───────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" height="100%">
      <HeaderBar gatewayStatus={gatewayStatus} />
      <Box flexGrow={1} flexDirection="column">
        {showQuit ? (
          <QuitDialog onCancel={() => setShowQuit(false)} />
        ) : (
          renderPanel()
        )}
      </Box>
      <FooterBar shortcuts={PANEL_SHORTCUTS[currentPanel]} />
    </Box>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

export function App({ onRegisterShutdown }: AppProps): React.ReactElement {
  return (
    <AppProvider>
      <AppContent onRegisterShutdown={onRegisterShutdown} />
    </AppProvider>
  );
}
