import type { GatewayConfig } from "../infra/types.js";
import type { ChromeManagerState } from "../infra/chrome-manager.js";
import type { TokenRefresher } from "../core/token-refresher.js";
import type { ServerHandle } from "../server.js";
import type { RequestActivityTracker } from "../core/request-activity-tracker.js";
import type { RequestQueue } from "../core/request-queue.js";

// ── Panel IDs ─────────────────────────────────────────────────────────────────

export type PanelId = "splash" | "menu" | "gateway" | "chat" | "info" | "settings";

// ── App State ─────────────────────────────────────────────────────────────────

export interface TuiAppState {
  currentPanel: PanelId;
  gatewayStatus: "stopped" | "starting" | "running" | "error";
  gatewayError: string | null;
  activeModel: string;
  config: GatewayConfig;
  serverHandle: ServerHandle | null;
  chromeState: ChromeManagerState | null;
  tokenRefresher: TokenRefresher | null;
  requestTracker: RequestActivityTracker | null;
  requestQueue: RequestQueue | null;
}

// ── Menu ──────────────────────────────────────────────────────────────────────

export interface MenuItem {
  id: PanelId | "quit";
  label: string;
  description: string;
}

export const MENU_ITEMS: MenuItem[] = [
  { id: "gateway", label: "Start Gateway", description: "Launch Chrome, authenticate, and start the HTTP server" },
  { id: "chat", label: "Chat", description: "Send a test message to the running gateway" },
  { id: "info", label: "Server Info", description: "View and copy the server URL and API key" },
  { id: "settings", label: "Settings", description: "View and edit gateway configuration" },
  { id: "quit", label: "Quit", description: "Exit jh-gateway" },
];

// ── Gateway Phase ─────────────────────────────────────────────────────────────

export interface GatewayPhase {
  label: string;
  status: "pending" | "active" | "done" | "error";
}

// ── Footer Shortcut ───────────────────────────────────────────────────────────

export type FooterShortcut = { key: string; label: string };
