/**
 * `serve` command — start the HTTP server.
 */
import { loadConfig, updateConfig } from "../infra/config.js";
import { connectToChrome, findOrOpenJhPage } from "../infra/chrome-cdp.js";
import { startServer } from "../server.js";
import type { Page } from "playwright-core";

export async function runServe(options: { port?: number }): Promise<void> {
  const config = await loadConfig();

  if (options.port !== undefined) {
    await updateConfig({ port: options.port });
    config.port = options.port;
  }

  let page: Page | null = null;
  let browser: { close(): Promise<void> } | undefined;
  try {
    const conn = await connectToChrome(config.cdpUrl);
    page = await findOrOpenJhPage(conn.browser);
    browser = conn.browser;
    console.log(`Connected to Chrome at ${config.cdpUrl}`);

    const currentUrl = page.url();
    if (!currentUrl.includes("chat.ai.jh.edu")) {
      console.log("Navigating to chat.ai.jh.edu...");
      await page.goto("https://chat.ai.jh.edu", { waitUntil: "networkidle" });
    }
    console.log(`Browser page: ${page.url()}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: Could not connect to Chrome: ${msg}`);
    console.warn("Chat completions will fail until Chrome is available.");
  }

  await startServer(config, {
    getPage: () => page,
    getCredentials: () => config.credentials,
    browser,
  });
}
