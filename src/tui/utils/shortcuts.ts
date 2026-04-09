import type { PanelId, FooterShortcut } from "../types.js";

export const PANEL_SHORTCUTS: Record<PanelId, FooterShortcut[]> = {
  splash: [
    { key: "any", label: "Continue" },
  ],
  menu: [
    { key: "↑↓", label: "Navigate" },
    { key: "Enter", label: "Select" },
    { key: "q", label: "Quit" },
  ],
  gateway: [
    { key: "Enter", label: "Start/Stop" },
    { key: "b", label: "Back" },
    { key: "q", label: "Quit" },
  ],
  model: [
    { key: "↑↓", label: "Navigate" },
    { key: "Enter", label: "Select" },
    { key: "b", label: "Back" },
    { key: "q", label: "Quit" },
  ],
  chat: [
    { key: "Enter", label: "Send" },
    { key: "b", label: "Back" },
    { key: "q", label: "Quit" },
  ],
  info: [
    { key: "c", label: "Copy URL" },
    { key: "k", label: "Copy Key" },
    { key: "b", label: "Back" },
    { key: "q", label: "Quit" },
  ],
  settings: [
    { key: "Enter", label: "Edit" },
    { key: "b", label: "Back" },
    { key: "q", label: "Quit" },
  ],
};
