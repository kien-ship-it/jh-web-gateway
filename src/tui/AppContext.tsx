import React, { createContext, useContext, useState, useEffect } from "react";
import { loadConfig } from "../infra/config.js";
import type { GatewayConfig } from "../infra/types.js";
import type { TuiAppState, PanelId } from "./types.js";
import type { ChromeManagerState } from "../infra/chrome-manager.js";
import type { TokenRefresher } from "../core/token-refresher.js";
import type { ServerHandle } from "../server.js";
import type { RequestActivityTracker } from "../core/request-activity-tracker.js";
import type { RequestQueue } from "../core/request-queue.js";

// ── Context value type ─────────────────────────────────────────────────────────

interface AppContextValue {
  state: TuiAppState;
  navigate: (panelId: PanelId) => void;
  setGatewayStatus: (status: TuiAppState["gatewayStatus"]) => void;
  setGatewayError: (error: string | null) => void;
  setActiveModel: (model: string) => void;
  setServerHandle: (handle: ServerHandle | null) => void;
  setChromeState: (state: ChromeManagerState | null) => void;
  setTokenRefresher: (refresher: TokenRefresher | null) => void;
  setConfig: (config: GatewayConfig) => void;
  setRequestTracker: (tracker: RequestActivityTracker | null) => void;
  setRequestQueue: (queue: RequestQueue | null) => void;
}

// ── Default/initial state ──────────────────────────────────────────────────────

const defaultConfig: GatewayConfig = {
  cdpUrl: "http://127.0.0.1:9222",
  port: 8741,
  defaultModel: "claude-opus-4.5",
  defaultEndpoint: "AnthropicClaude",
  credentials: null,
  auth: { mode: "none", token: null },
  maxQueueWaitMs: 120000,
};

const initialState: TuiAppState = {
  currentPanel: "splash",
  gatewayStatus: "stopped",
  gatewayError: null,
  activeModel: defaultConfig.defaultModel,
  config: defaultConfig,
  serverHandle: null,
  chromeState: null,
  tokenRefresher: null,
  requestTracker: null,
  requestQueue: null,
};

// ── Context ────────────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

interface AppProviderProps {
  children: React.ReactNode;
}

export function AppProvider({ children }: AppProviderProps): React.ReactElement {
  const [state, setState] = useState<TuiAppState>(initialState);

  useEffect(() => {
    loadConfig()
      .then((config) => {
        setState((prev) => ({
          ...prev,
          config,
          activeModel: config.defaultModel,
        }));
      })
      .catch(() => {
        // Keep defaults on error
      });
  }, []);

  const navigate = (panelId: PanelId): void => {
    setState((prev) => ({ ...prev, currentPanel: panelId }));
  };

  const setGatewayStatus = (status: TuiAppState["gatewayStatus"]): void => {
    setState((prev) => ({ ...prev, gatewayStatus: status }));
  };

  const setGatewayError = (error: string | null): void => {
    setState((prev) => ({ ...prev, gatewayError: error }));
  };

  const setActiveModel = (model: string): void => {
    setState((prev) => ({ ...prev, activeModel: model }));
  };

  const setServerHandle = (handle: ServerHandle | null): void => {
    setState((prev) => ({ ...prev, serverHandle: handle }));
  };

  const setChromeState = (chromeState: ChromeManagerState | null): void => {
    setState((prev) => ({ ...prev, chromeState }));
  };

  const setTokenRefresher = (refresher: TokenRefresher | null): void => {
    setState((prev) => ({ ...prev, tokenRefresher: refresher }));
  };

  const setConfig = (config: GatewayConfig): void => {
    setState((prev) => ({ ...prev, config }));
  };

  const setRequestTracker = (requestTracker: RequestActivityTracker | null): void => {
    setState((prev) => ({ ...prev, requestTracker }));
  };

  const setRequestQueue = (requestQueue: RequestQueue | null): void => {
    setState((prev) => ({ ...prev, requestQueue }));
  };

  const value: AppContextValue = {
    state,
    navigate,
    setGatewayStatus,
    setGatewayError,
    setActiveModel,
    setServerHandle,
    setChromeState,
    setTokenRefresher,
    setConfig,
    setRequestTracker,
    setRequestQueue,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppContext must be used within AppProvider");
  }
  return ctx;
}
