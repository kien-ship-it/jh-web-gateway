/**
 * `start` command — unified single-command startup.
 * Orchestrates Chrome connection, authentication, server startup,
 * and background token refresh in one terminal.
 */
import * as p from "@clack/prompts";
import { loadConfig, updateConfig } from "../infra/config.js";
import { ChromeManager } from "../infra/chrome-manager.js";
import type { ChromeManagerState } from "../infra/chrome-manager.js";
import { findOrOpenJhPage, checkBrowserLoginState } from "../infra/chrome-cdp.js";
import { captureCredentials, getTokenExpiry } from "../core/auth-capture.js";
import { shouldRefresh, CredentialHolder, TokenRefresher } from "../core/token-refresher.js";
import { ReauthLock } from "../core/reauth-lock.js";
import { PagePool } from "../core/page-pool.js";
import { startServer } from "../server.js";

export interface StartOptions {
    port?: number;
    pages?: number;
    headless?: boolean;
}

export async function runStart(options: StartOptions): Promise<void> {
    // ── Load config and apply overrides ─────────────────────────────────
    const config = await loadConfig();

    if (options.port !== undefined) {
        await updateConfig({ port: options.port });
        config.port = options.port;
    }

    const maxPages = options.pages ?? 3;
    const cdpPort = parseInt(new URL(config.cdpUrl).port, 10) || 9222;

    const chromeManager = new ChromeManager({
        cdpPort,
        headless: options.headless,
    });

    // ── Phase 1: Connect to Chrome ──────────────────────────────────────
    const s = p.spinner();
    s.start("Connecting to Chrome...");

    let state: ChromeManagerState;
    try {
        state = await chromeManager.connect();
        s.stop(
            state.selfLaunched
                ? "Chrome launched and connected."
                : "Connected to existing Chrome instance.",
        );
        await chromeManager.showWindow(state);
    } catch (err) {
        s.stop("Failed to connect to Chrome.");
        throw err;
    }

    // ── Phase 2: Authenticate if needed ─────────────────────────────────
    const needsAuth =
        !config.credentials ||
        !config.credentials.expiresAt ||
        shouldRefresh(Date.now(), config.credentials.expiresAt, 0);

    if (needsAuth && options.headless) {
        await chromeManager.shutdown(state);
        throw new Error(
            "Cannot authenticate in headless mode — no browser window to log in.\n" +
            "Run `jh-gateway start` (without --headless) first to log in, then use --headless on subsequent runs.",
        );
    }

    if (needsAuth) {
        s.start("Waiting for login (timeout: 300s)...");
        try {
            const creds = await captureCredentials(config.cdpUrl, 300_000);
            config.credentials = {
                bearerToken: creds.bearerToken,
                cookie: creds.cookie,
                userAgent: creds.userAgent,
                expiresAt: creds.expiresAt,
            };

            const expiryStr = creds.expiresAt
                ? new Date(creds.expiresAt * 1000).toLocaleString()
                : "unknown";
            s.stop(`Credentials captured. Token expires: ${expiryStr}`);
        } catch (err) {
            s.stop("Authentication failed.");
            // Clean up Chrome if we launched it
            await chromeManager.shutdown(state);
            throw err;
        }
    } else {
        p.log.info("Valid credentials found. Verifying browser session…");
        const browserLoggedIn = await checkBrowserLoginState(state.browser);
        if (!browserLoggedIn) {
            p.log.warn(
                "Browser session has expired — please log in to chat.ai.jh.edu.",
            );
            s.start("Waiting for login (timeout: 300s)…");
            try {
                const creds = await captureCredentials(config.cdpUrl, 300_000);
                config.credentials = {
                    bearerToken: creds.bearerToken,
                    cookie: creds.cookie,
                    userAgent: creds.userAgent,
                    expiresAt: creds.expiresAt,
                };
                const expiryStr = creds.expiresAt
                    ? new Date(creds.expiresAt * 1000).toLocaleString()
                    : "unknown";
                s.stop(`Credentials re-captured. Token expires: ${expiryStr}`);
            } catch (err) {
                s.stop("Re-authentication failed.");
                await chromeManager.shutdown(state);
                throw err;
            }
        }
    }

    // ── Phase 3: Initialize PagePool, CredentialHolder, ReauthLock, Server
    s.start(`Starting server on port ${config.port}...`);

    // Find the seed page for the pool
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

    const _reauthLock = new ReauthLock();

    const serverHandle = await startServer(config, {
        getPool: () => pool,
        getCredentials: () => credentialHolder.get(),
        browser: state.browser,
    });

    s.stop(`Server running on port ${config.port}.`);

    // ── Phase 4: Start TokenRefresher background loop ───────────────────
    const tokenRefresher = new TokenRefresher(credentialHolder, config.cdpUrl);
    tokenRefresher.start();

    // ── Display success info ────────────────────────────────────────────
    const baseUrl = `http://127.0.0.1:${config.port}`;
    const apiKey = config.auth.token ?? "(no auth required)";

    p.log.success(`Gateway ready!`);
    p.log.info(`Base URL:  ${baseUrl}`);
    p.log.info(`API Key:   ${apiKey}`);
    p.log.info("Press Ctrl+C to stop.");

    // ── Shutdown handler ────────────────────────────────────────────────
    // disconnect (not shutdown): hides Chrome and detaches CDP, but keeps
    // the Chrome process alive so the next `start` reconnects instantly.
    const shutdown = async () => {
        tokenRefresher.stop();
        await serverHandle.close();
        await chromeManager.disconnect(state);
    };

    process.on("SIGINT", async () => {
        await shutdown();
        process.exit(0);
    });
    process.on("SIGTERM", async () => {
        await shutdown();
        process.exit(0);
    });
}
