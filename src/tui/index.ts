import React from "react";
import { render } from "ink";
import { App } from "./App.js";

export async function launchTui(): Promise<void> {
  // ── Terminal size check ────────────────────────────────────────────────────
  const checkSize = (): boolean => {
    const cols = process.stdout.columns ?? 0;
    const rows = process.stdout.rows ?? 0;
    return cols >= 80 && rows >= 24;
  };

  if (!checkSize()) {
    process.stderr.write(
      `Terminal too small (${process.stdout.columns ?? 0}×${process.stdout.rows ?? 0}). ` +
        `Please resize to at least 80×24.\n`,
    );
    await new Promise<void>((resolve) => {
      const onResize = () => {
        if (checkSize()) {
          process.stdout.removeListener("resize", onResize);
          resolve();
        }
      };
      process.stdout.on("resize", onResize);
    });
  }

  // ── Shutdown callback registered by AppContent ─────────────────────────────
  let shutdown: (() => Promise<void>) | null = null;

  const { waitUntilExit, unmount } = render(
    React.createElement(App, {
      onRegisterShutdown: (fn) => {
        shutdown = fn;
      },
    }),
    { exitOnCtrlC: false },
  );

  // ── Signal handlers ────────────────────────────────────────────────────────
  const handleSignal = (): void => {
    void (async () => {
      try {
        if (shutdown) await shutdown();
      } catch {
        // ignore errors during graceful shutdown
      }
      unmount();
      process.exit(0);
    })();
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  // ── Unhandled error safety net ─────────────────────────────────────────────
  process.on("uncaughtException", (err) => {
    unmount();
    process.stderr.write(`Unhandled error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });

  try {
    await waitUntilExit();
  } finally {
    process.removeListener("SIGINT", handleSignal);
    process.removeListener("SIGTERM", handleSignal);
  }
}
