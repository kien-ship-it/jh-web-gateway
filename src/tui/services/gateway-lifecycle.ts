import { ChromeManager } from "../../infra/chrome-manager.js";
import type { ChromeManagerState } from "../../infra/chrome-manager.js";
import { findOrOpenJhPage } from "../../infra/chrome-cdp.js";
import { captureCredentials } from "../../core/auth-capture.js";
import { shouldRefresh, CredentialHolder, TokenRefresher } from "../../core/token-refresher.js";
import { PagePool } from "../../core/page-pool.js";
import { startServer } from "../../server.js";
import type { ServerHandle } from "../../server.js";
import type { GatewayConfig } from "../../infra/types.js";

export interface GatewayLifecycleCallbacks {
  onPhase: (phase: string) => void;
  onSuccess: (info: { baseUrl: string; apiKey: string | null }) => void;
  onError: (error: Error) => void;
}

export interface StartGatewayResult {
  serverHandle: ServerHandle;
  chromeState: ChromeManagerState;
  tokenRefresher: TokenRefresher;
}

export async function startGatewayForTui(
  config: GatewayConfig,
  options: { headless?: boolean; pages?: number },
  callbacks: GatewayLifecycleCallbacks,
): Promise<StartGatewayResult> {
  const maxPages = options.pages ?? 3;
  const cdpPort = parseInt(new URL(config.cdpUrl).port, 10) || 9222;

  const chromeManager = new ChromeManager({
    cdpPort,
    headless: options.headless,
  });

  // ── Phase 1: Connect to Chrome ────────────────────────────────────────────
  callbacks.onPhase("Connecting to Chrome");
  let state: ChromeManagerState;
  try {
    state = await chromeManager.connect();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    callbacks.onError(error);
    throw error;
  }

  // ── Phase 2: Authenticate if needed ──────────────────────────────────────
  const needsAuth =
    !config.credentials ||
    !config.credentials.expiresAt ||
    shouldRefresh(Date.now(), config.credentials.expiresAt, 0);

  if (needsAuth) {
    callbacks.onPhase("Waiting for login");
    try {
      await findOrOpenJhPage(state.browser);
      const creds = await captureCredentials(config.cdpUrl, 300_000);
      config.credentials = {
        bearerToken: creds.bearerToken,
        cookie: creds.cookie,
        userAgent: creds.userAgent,
        expiresAt: creds.expiresAt,
      };
      await chromeManager.minimizeWindow(state);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      await chromeManager.shutdown(state);
      throw error;
    }
  }

  // ── Phase 3: PagePool, CredentialHolder, Server ───────────────────────────
  callbacks.onPhase("Starting server");
  try {
    const seedPage = await findOrOpenJhPage(state.browser);

    const pool = new PagePool({
      maxPages,
      maxWaitMs: config.maxQueueWaitMs,
    });
    await pool.init(state.browser, seedPage);

    const credentialHolder = new CredentialHolder();
    if (config.credentials) {
      credentialHolder.set(config.credentials);
    }

    const serverHandle = await startServer(config, {
      getPool: () => pool,
      getCredentials: () => credentialHolder.get(),
    });

    const tokenRefresher = new TokenRefresher(credentialHolder, config.cdpUrl);
    tokenRefresher.start();

    const baseUrl = `http://127.0.0.1:${config.port}`;
    const apiKey = config.auth.token ?? null;
    callbacks.onSuccess({ baseUrl, apiKey });

    return { serverHandle, chromeState: state, tokenRefresher };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    callbacks.onError(error);
    await chromeManager.shutdown(state);
    throw error;
  }
}

export async function stopGateway(
  serverHandle: ServerHandle,
  chromeState: ChromeManagerState,
  tokenRefresher: TokenRefresher,
): Promise<void> {
  tokenRefresher.stop();
  await serverHandle.close();

  const cdpPort = 9222;
  const chromeManager = new ChromeManager({ cdpPort });
  await chromeManager.shutdown(chromeState);
}
