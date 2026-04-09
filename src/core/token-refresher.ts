import type { GatewayCredentials } from "../infra/types.js";
import { captureCredentials } from "./auth-capture.js";
import { updateConfig } from "../infra/config.js";

/**
 * Thread-safe holder for the current gateway credentials.
 * After the first `set()`, `get()` will never return `null`.
 */
export class CredentialHolder {
    private creds: GatewayCredentials | null = null;

    /** Returns the current credentials, or `null` if none have been set yet. */
    get(): GatewayCredentials | null {
        return this.creds;
    }

    /** Atomically replaces the stored credentials. */
    set(creds: GatewayCredentials): void {
        this.creds = creds;
    }
}

/**
 * Returns true if the token should be refreshed.
 *
 * @param nowMs - Current time in milliseconds (e.g. Date.now())
 * @param expiresAt - JWT exp claim in unix seconds
 * @param thresholdMs - Refresh threshold in milliseconds
 */
export function shouldRefresh(
    nowMs: number,
    expiresAt: number,
    thresholdMs: number,
): boolean {
    return expiresAt * 1000 - nowMs < thresholdMs;
}

export interface TokenRefresherOptions {
    checkIntervalMs?: number;       // default: 60_000
    refreshBeforeExpiryMs?: number; // default: 300_000 (5 min)
    maxRetries?: number;            // default: 3
}

const BACKOFF_DELAYS = [5_000, 15_000, 30_000];

/**
 * Background service that monitors JWT expiry and proactively
 * re-captures credentials before they expire.
 */
export class TokenRefresher {
    private credentialHolder: CredentialHolder;
    private cdpUrl: string;
    private checkIntervalMs: number;
    private refreshBeforeExpiryMs: number;
    private maxRetries: number;
    private intervalId: ReturnType<typeof setInterval> | null = null;

    constructor(
        credentialHolder: CredentialHolder,
        cdpUrl: string,
        options?: TokenRefresherOptions,
    ) {
        this.credentialHolder = credentialHolder;
        this.cdpUrl = cdpUrl;
        this.checkIntervalMs = options?.checkIntervalMs ?? 60_000;
        this.refreshBeforeExpiryMs = options?.refreshBeforeExpiryMs ?? 300_000;
        this.maxRetries = options?.maxRetries ?? 3;
    }

    /** Start the background check interval. */
    start(): void {
        if (this.intervalId !== null) return;
        this.intervalId = setInterval(() => {
            void this.checkAndRefresh();
        }, this.checkIntervalMs);
    }

    /** Stop the background check interval. */
    stop(): void {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /** Check if a refresh is needed and perform it. Returns true if refreshed. */
    async checkAndRefresh(): Promise<boolean> {
        const creds = this.credentialHolder.get();
        if (!creds || !creds.expiresAt) {
            return false;
        }

        if (!shouldRefresh(Date.now(), creds.expiresAt, this.refreshBeforeExpiryMs)) {
            return false;
        }

        // Attempt refresh with retries and backoff
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                const newCreds = await captureCredentials(this.cdpUrl);
                const gatewayCreds: GatewayCredentials = {
                    bearerToken: newCreds.bearerToken,
                    cookie: newCreds.cookie,
                    userAgent: newCreds.userAgent,
                    expiresAt: newCreds.expiresAt,
                };

                this.credentialHolder.set(gatewayCreds);
                await updateConfig({ credentials: gatewayCreds });

                const expiryDate = new Date(newCreds.expiresAt * 1000).toISOString();
                console.log(`[TokenRefresher] Credentials refreshed successfully. New expiry: ${expiryDate}`);
                return true;
            } catch (err) {
                const delay = BACKOFF_DELAYS[attempt] ?? BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1];
                if (attempt < this.maxRetries - 1) {
                    console.warn(
                        `[TokenRefresher] Refresh attempt ${attempt + 1}/${this.maxRetries} failed, retrying in ${delay / 1000}s...`,
                    );
                    await this.sleep(delay);
                } else {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.warn(
                        `\n⚠️  [TokenRefresher] All ${this.maxRetries} refresh attempts failed. ${msg}\n` +
                        `   Continuing with current credentials. If requests start failing with 401,\n` +
                        `   restart with \`jh-gateway start\` (without --headless) to re-login.\n`,
                    );
                }
            }
        }

        return false;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
