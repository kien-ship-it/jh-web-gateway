/**
 * `serve` command — start the HTTP server.
 */
import { loadConfig, updateConfig } from "../infra/config.js";
import { connectToChrome, findOrOpenJhPage } from "../infra/chrome-cdp.js";
import { startServer } from "../server.js";
import { PagePool } from "../core/page-pool.js";
import type { Page } from "playwright-core";

export async function runServe(options: { port?: number; pages?: number }): Promise<void> {
  const config = await loadConfig();

  if (options.port !== undefined) {
    await updateConfig({ port: options.port });
    config.port = options.port;
  }

  const maxPages = options.pages ?? 3;

  let pool: PagePool | null = null;
  let browser: { close(): Promise<void> } | undefined;
  try {
    const conn = await connectToChrome(config.cdpUrl);
    const seedPage = await findOrOpenJhPage(conn.browser);
    browser = conn.browser;
    console.log(`Connected to Chrome at ${config.cdpUrl}`);

    const currentUrl = seedPage.url();
    if (!currentUrl.includes("chat.ai.jh.edu")) {
      console.log("Navigating to chat.ai.jh.edu...");
      await seedPage.goto("https://chat.ai.jh.edu", { waitUntil: "networkidle" });
    }
    console.log(`Browser page: ${seedPage.url()}`);

    // Initialize the page pool
    pool = new PagePool({
      maxPages,
      maxWaitMs: config.maxQueueWaitMs,
    });
    await pool.init(conn.browser, seedPage);
    console.log(`Page pool initialized (max ${maxPages} concurrent pages)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: Could not connect to Chrome: ${msg}`);
    console.warn("Chat completions will fail until Chrome is available.");
  }

  await startServer(config, {
    getPool: () => pool,
    getCredentials: () => config.credentials,
    browser,
  });
}
