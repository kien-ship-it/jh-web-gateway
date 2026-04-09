import type { GatewayCredentials } from "../infra/types.js";

/**
 * Deduplication lock ensuring only one credential re-capture runs at a time.
 * Concurrent callers share the same in-flight promise; after it settles the
 * lock resets so the next `acquire()` starts a fresh re-capture.
 */
export class ReauthLock {
    private inflight: Promise<GatewayCredentials> | null = null;

    async acquire(
        recaptureFn: () => Promise<GatewayCredentials>,
    ): Promise<GatewayCredentials> {
        if (this.inflight) {
            return this.inflight;
        }

        this.inflight = recaptureFn().finally(() => {
            this.inflight = null;
        });

        return this.inflight;
    }
}
