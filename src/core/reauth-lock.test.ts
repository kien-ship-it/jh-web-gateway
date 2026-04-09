import { describe, it, expect } from "vitest";
import { ReauthLock } from "./reauth-lock.js";
import type { GatewayCredentials } from "../infra/types.js";

const fakeCreds = (token: string): GatewayCredentials => ({
    bearerToken: token,
    cookie: "c",
    userAgent: "ua",
    expiresAt: 9999999999,
});

describe("ReauthLock", () => {
    it("calls recaptureFn and returns its result", async () => {
        const lock = new ReauthLock();
        const result = await lock.acquire(() => Promise.resolve(fakeCreds("t1")));
        expect(result.bearerToken).toBe("t1");
    });

    it("deduplicates concurrent acquire() calls", async () => {
        const lock = new ReauthLock();
        let callCount = 0;

        const slow = () =>
            new Promise<GatewayCredentials>((resolve) => {
                callCount++;
                setTimeout(() => resolve(fakeCreds("shared")), 50);
            });

        const results = await Promise.all([
            lock.acquire(slow),
            lock.acquire(slow),
            lock.acquire(slow),
        ]);

        expect(callCount).toBe(1);
        for (const r of results) {
            expect(r.bearerToken).toBe("shared");
        }
    });

    it("resets after promise resolves so next acquire starts fresh", async () => {
        const lock = new ReauthLock();
        let callCount = 0;

        const fn = () => {
            callCount++;
            return Promise.resolve(fakeCreds(`t${callCount}`));
        };

        const first = await lock.acquire(fn);
        expect(first.bearerToken).toBe("t1");

        const second = await lock.acquire(fn);
        expect(second.bearerToken).toBe("t2");
        expect(callCount).toBe(2);
    });

    it("resets after promise rejects so next acquire starts fresh", async () => {
        const lock = new ReauthLock();
        let callCount = 0;

        await expect(
            lock.acquire(() => {
                callCount++;
                return Promise.reject(new Error("fail"));
            }),
        ).rejects.toThrow("fail");

        const result = await lock.acquire(() => {
            callCount++;
            return Promise.resolve(fakeCreds("recovered"));
        });

        expect(result.bearerToken).toBe("recovered");
        expect(callCount).toBe(2);
    });

    it("propagates rejection to all concurrent callers", async () => {
        const lock = new ReauthLock();
        let callCount = 0;

        const failing = () => {
            callCount++;
            return new Promise<GatewayCredentials>((_, reject) => {
                setTimeout(() => reject(new Error("boom")), 20);
            });
        };

        const results = await Promise.allSettled([
            lock.acquire(failing),
            lock.acquire(failing),
        ]);

        expect(callCount).toBe(1);
        for (const r of results) {
            expect(r.status).toBe("rejected");
        }
    });
});

import fc from "fast-check";

/**
 * Property 4: ReauthLock deduplication
 * Validates: Requirements 6.4
 *
 * For any N concurrent acquire() calls, recaptureFn is invoked exactly once,
 * and all N callers receive the same resolved credentials. After the promise
 * settles, a subsequent acquire() invokes recaptureFn again (lock resets).
 */
describe("ReauthLock — Property 4: deduplication", () => {
    it("recaptureFn is called exactly once for N concurrent acquires, all callers get the same result, and lock resets afterward", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 2, max: 50 }),
                async (n) => {
                    const lock = new ReauthLock();
                    let callCount = 0;

                    const recaptureFn = (): Promise<GatewayCredentials> => {
                        callCount++;
                        return new Promise((resolve) =>
                            setTimeout(
                                () =>
                                    resolve(
                                        fakeCreds(`batch-${callCount}`),
                                    ),
                                5,
                            ),
                        );
                    };

                    // Fire N concurrent acquire() calls
                    const promises = Array.from({ length: n }, () =>
                        lock.acquire(recaptureFn),
                    );
                    const results = await Promise.all(promises);

                    // recaptureFn must have been called exactly once
                    expect(callCount).toBe(1);

                    // All callers must receive the same credentials object
                    const first = results[0];
                    for (const r of results) {
                        expect(r).toBe(first);
                        expect(r.bearerToken).toBe("batch-1");
                    }

                    // After settling, a new acquire() should invoke recaptureFn again
                    const next = await lock.acquire(recaptureFn);
                    expect(callCount).toBe(2);
                    expect(next.bearerToken).toBe("batch-2");
                },
            ),
            { numRuns: 100 },
        );
    });
});
