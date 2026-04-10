import { existsSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import { getChromeWebSocketUrl } from "./chrome-cdp.js";

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface ChromeManagerOptions {
    /** CDP remote debugging port. Default: 9222 */
    cdpPort?: number;
    /** Launch Chrome in headless mode. Default: false */
    headless?: boolean;
    /** Chrome user data directory. Default: ~/.jh-gateway/chrome-profile */
    userDataDir?: string;
}

export interface ChromeManagerState {
    browser: Browser;
    /** true if ChromeManager spawned the process */
    selfLaunched: boolean;
    /** Only set when selfLaunched is true */
    process?: ChildProcess;
}

// ── Chrome path constants ─────────────────────────────────────────────────────

const MACOS_CHROME_PATH =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const WINDOWS_CHROME_PATHS = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const LINUX_CHROME_CANDIDATES = [
    "google-chrome",
    "google-chrome-stable",
    "chromium-browser",
    "chromium",
];

// ── ChromeManager ─────────────────────────────────────────────────────────────

export class ChromeManager {
    private readonly cdpPort: number;
    private readonly headless: boolean;
    private readonly userDataDir: string;

    constructor(options?: ChromeManagerOptions) {
        this.cdpPort = options?.cdpPort ?? 9222;
        this.headless = options?.headless ?? false;
        this.userDataDir =
            options?.userDataDir ?? join(homedir(), ".jh-gateway", "chrome-profile");
    }

    /**
     * Try connecting to an existing Chrome instance at the configured CDP port.
     * If no instance is running, launch a new Chrome process and connect to it.
     */
    async connect(): Promise<ChromeManagerState> {
        const cdpUrl = `http://127.0.0.1:${this.cdpPort}`;

        // ── Phase 1: Try connecting to an existing Chrome instance ────────
        try {
            const wsUrl = await getChromeWebSocketUrl(cdpUrl);
            const browser = await chromium.connectOverCDP(wsUrl);
            return { browser, selfLaunched: false };
        } catch {
            // No existing Chrome — fall through to launch
        }

        // ── Phase 2: Find Chrome and launch it ───────────────────────────
        const chromePath = ChromeManager.findChromePath();
        if (!chromePath) {
            throw new Error(
                `Chrome executable not found. Please install Google Chrome or Chromium.\n` +
                `Expected locations for ${process.platform}:\n` +
                (process.platform === "darwin"
                    ? `  - ${MACOS_CHROME_PATH}\n`
                    : process.platform === "linux"
                        ? LINUX_CHROME_CANDIDATES.map((c) => `  - ${c} (via PATH)`).join("\n") + "\n"
                        : WINDOWS_CHROME_PATHS.map((p) => `  - ${p}`).join("\n") + "\n"),
            );
        }

        const args = [
            `--remote-debugging-port=${this.cdpPort}`,
            `--user-data-dir=${this.userDataDir}`,
            "--no-first-run",
            "--no-default-browser-check",
        ];
        if (this.headless) {
            args.push("--headless=new");
        }

        const child = spawn(chromePath, args, {
            detached: false,
            stdio: "ignore",
        });

        // ── Phase 3: Wait for CDP to become available ─────────────────────
        await this.waitForCdp(cdpUrl);

        // ── Phase 4: Connect via Playwright ───────────────────────────────
        const wsUrl = await getChromeWebSocketUrl(cdpUrl);
        const browser = await chromium.connectOverCDP(wsUrl);

        return { browser, selfLaunched: true, process: child };
    }

    /**
     * Poll the CDP /json/version endpoint until it responds, or timeout.
     */
    private async waitForCdp(
        cdpUrl: string,
        timeoutMs: number = 15_000,
        intervalMs: number = 250,
    ): Promise<void> {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            try {
                const res = await fetch(`${cdpUrl}/json/version`);
                if (res.ok) return;
            } catch {
                // Not ready yet
            }
            await new Promise((r) => setTimeout(r, intervalMs));
        }

        throw new Error(
            `Chrome did not become available at ${cdpUrl} within ${timeoutMs / 1000}s`,
        );
    }

    /**
     * Terminate managed Chrome (only if selfLaunched).
     * Tries to close the browser connection gracefully first, then kills the process.
     */
    async shutdown(state: ChromeManagerState): Promise<void> {
        if (!state.selfLaunched || !state.process) {
            return;
        }

        try {
            await state.browser.close();
        } catch {
            // Browser may already be disconnected — ignore
        }

        try {
            state.process.kill("SIGTERM");
        } catch {
            // Process may already be dead — ignore
        }
    }

    /**
     * Attempt to relaunch and reconnect to Chrome within 30s.
     * Returns a fresh ChromeManagerState.
     */
    async reconnect(): Promise<ChromeManagerState> {
        const RECONNECT_TIMEOUT_MS = 30_000;
        const deadline = Date.now() + RECONNECT_TIMEOUT_MS;

        while (Date.now() < deadline) {
            try {
                return await this.connect();
            } catch {
                await new Promise((r) => setTimeout(r, 1_000));
            }
        }

        throw new Error(
            `Failed to reconnect to Chrome within ${RECONNECT_TIMEOUT_MS / 1000}s`,
        );
    }

    /**
     * Show / unhide the Chrome window.
     * On macOS: uses osascript to set the process visible again.
     * On other platforms: restores the window via CDP.
     * Best-effort — errors are silently caught.
     */
    async showWindow(state: ChromeManagerState): Promise<void> {
        if (process.platform === "darwin") {
            try {
                const pid = state.process?.pid;
                if (pid !== undefined) {
                    execSync(
                        `osascript -e 'tell application "System Events" to set visible of (first process whose unix id is ${pid}) to true'`,
                        { stdio: "pipe" },
                    );
                } else {
                    execSync(
                        `osascript -e 'tell application "System Events" to set visible of process "Google Chrome" to true'`,
                        { stdio: "pipe" },
                    );
                }
                return;
            } catch {
                // Fall back to CDP restore
            }
        }
        try {
            const page = state.browser.contexts()[0]?.pages()[0];
            if (!page) return;

            const cdpSession = await page.context().newCDPSession(page);
            const { windowId } = (await cdpSession.send(
                "Browser.getWindowForTarget",
            )) as { windowId: number };
            await cdpSession.send("Browser.setWindowBounds", {
                windowId,
                bounds: { windowState: "normal" },
            });
        } catch {
            // Best-effort — silently ignore errors
        }
    }

    /**
     * Hide the Chrome window.
     * On macOS: uses osascript to fully hide the window (equivalent to Cmd+H),
     * so it does not appear in the Dock as a minimized tile.
     * On other platforms: falls back to CDP minimize.
     * Best-effort — errors are silently caught.
     */
    async hideWindow(state: ChromeManagerState): Promise<void> {
        if (process.platform === "darwin") {
            try {
                const pid = state.process?.pid;
                if (pid !== undefined) {
                    execSync(
                        `osascript -e 'tell application "System Events" to set visible of (first process whose unix id is ${pid}) to false'`,
                        { stdio: "pipe" },
                    );
                } else {
                    execSync(
                        `osascript -e 'tell application "System Events" to set visible of process "Google Chrome" to false'`,
                        { stdio: "pipe" },
                    );
                }
                return;
            } catch {
                // Fall back to CDP minimize
            }
        }
        try {
            const page = state.browser.contexts()[0]?.pages()[0];
            if (!page) return;

            const cdpSession = await page.context().newCDPSession(page);
            const { windowId } = (await cdpSession.send(
                "Browser.getWindowForTarget",
            )) as { windowId: number };
            await cdpSession.send("Browser.setWindowBounds", {
                windowId,
                bounds: { windowState: "minimized" },
            });
        } catch {
            // Best-effort — silently ignore errors
        }
    }

    /**
     * Detect the Chrome/Chromium executable path for the current OS.
     * Returns the absolute path string, or `null` if no installation is found.
     */
    static findChromePath(): string | null {
        const platform = process.platform;

        if (platform === "darwin") {
            return existsSync(MACOS_CHROME_PATH) ? MACOS_CHROME_PATH : null;
        }

        if (platform === "linux") {
            for (const candidate of LINUX_CHROME_CANDIDATES) {
                try {
                    const resolved = execSync(`which ${candidate}`, {
                        encoding: "utf8",
                        stdio: ["pipe", "pipe", "pipe"],
                    }).trim();
                    if (resolved) {
                        return resolved;
                    }
                } catch {
                    // candidate not found, try next
                }
            }
            return null;
        }

        if (platform === "win32") {
            for (const winPath of WINDOWS_CHROME_PATHS) {
                if (existsSync(winPath)) {
                    return winPath;
                }
            }
            return null;
        }

        // Unsupported platform
        return null;
    }
}
