import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";

const DEFAULT_TIMEOUT_MS = 5000;
const JH_URL = "https://chat.ai.jh.edu";

/**
 * Fetch /json/version from Chrome's CDP HTTP endpoint and extract webSocketDebuggerUrl.
 * Throws a descriptive error if Chrome is unreachable or the response is malformed.
 */
export async function getChromeWebSocketUrl(
  cdpUrl: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let raw: string;
  try {
    const res = await fetch(`${cdpUrl}/json/version`, {
      signal: controller.signal,
    });
    raw = await res.text();
  } catch {
    throw new Error(
      `Chrome is not running or remote debugging is not enabled at ${cdpUrl}`
    );
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Unexpected CDP response format: ${raw}`);
  }

  const wsUrl =
    parsed !== null &&
    typeof parsed === "object" &&
    "webSocketDebuggerUrl" in parsed
      ? (parsed as Record<string, unknown>).webSocketDebuggerUrl
      : undefined;

  if (typeof wsUrl !== "string" || wsUrl.length === 0) {
    throw new Error(`Unexpected CDP response format: ${raw}`);
  }

  return wsUrl;
}

/**
 * Connect to Chrome via Playwright CDP.
 * Returns the Browser and the first existing page (or a new one).
 */
export async function connectToChrome(
  cdpUrl: string
): Promise<{ browser: Browser; page: Page }> {
  const wsUrl = await getChromeWebSocketUrl(cdpUrl);
  const browser = await chromium.connectOverCDP(wsUrl);

  const contexts = browser.contexts();
  const existingPage =
    contexts.length > 0 ? contexts[0].pages()[0] : undefined;

  const page =
    existingPage ??
    (await (contexts.length > 0
      ? contexts[0].newPage()
      : (await browser.newContext()).newPage()));

  return { browser, page };
}

/**
 * Check whether an existing browser page is still on chat.ai.jh.edu.
 * This is a **read-only** check — it does NOT navigate or open new tabs.
 * Returns true if at least one page URL contains "chat.ai.jh.edu",
 * false if no such page exists or all JH pages have redirected away.
 */
export async function checkBrowserLoginState(browser: Browser): Promise<boolean> {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().includes("chat.ai.jh.edu")) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Find an existing chat.ai.jh.edu page across all contexts, or open a new one.
 */
export async function findOrOpenJhPage(browser: Browser): Promise<Page> {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().includes("chat.ai.jh.edu")) {
        return page;
      }
    }
  }

  // No existing JH page found — open one
  const contexts = browser.contexts();
  const context =
    contexts.length > 0 ? contexts[0] : await browser.newContext();
  const page = await context.newPage();
  await page.goto(JH_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  return page;
}
