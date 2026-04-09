import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { shouldRefresh, CredentialHolder, TokenRefresher } from "./token-refresher.js";
import type { GatewayCredentials } from "../infra/types.js";

// Mock external dependencies that TokenRefresher calls
vi.mock("./auth-capture.js", () => ({
    captureCredentials: vi.fn(),
}));

vi.mock("../infra/config.js", () => ({
    updateConfig: vi.fn().mockResolvedValue(undefined),
}));

// Import the mocked modules so we can control their behavior
import { captureCredentials } from "./auth-capture.js";
import { updateConfig } from "../infra/config.js";

const mockCapture = vi.mocked(captureCredentials);
const mockUpdateConfig = vi.mocked(updateConfig);

describe("token-refresher", () => {
    /**
     * Property 1: Token refresh decision boundary
     * Validates: Requirements 3.2
     *
     * For any (nowMs, expiresAt, thresholdMs), shouldRefresh returns true
     * iff (expiresAt * 1000 - nowMs) < thresholdMs.
     */
    it("shouldRefresh returns true iff token is within threshold of expiry", () => {
        fc.assert(
            fc.property(
                fc.integer(),
                fc.integer(),
                fc.integer({ min: 1000, max: 600_000 }),
                (nowMs, expiresAt, thresholdMs) => {
                    const result = shouldRefresh(nowMs, expiresAt, thresholdMs);
                    const expected = expiresAt * 1000 - nowMs < thresholdMs;
                    expect(result).toBe(expected);
                },
            ),
            { numRuns: 100 },
        );
    });
});

describe("CredentialHolder — Property 2: Credential holder read consistency", () => {
    /**
     * Property 2: Credential holder read consistency
     * Validates: Requirements 3.6
     */

    const credArb = fc.record({
        bearerToken: fc.string({ minLength: 1 }),
        cookie: fc.string({ minLength: 1 }),
        userAgent: fc.string({ minLength: 1 }),
        expiresAt: fc.option(fc.nat(), { nil: undefined }),
    }) as fc.Arbitrary<GatewayCredentials>;

    type Op = { type: "get" } | { type: "set"; creds: GatewayCredentials };

    const opArb: fc.Arbitrary<Op> = fc.oneof(
        fc.constant<Op>({ type: "get" }),
        credArb.map((creds): Op => ({ type: "set", creds })),
    );

    it("get() never returns null after the first set(), and always returns the last set value", () => {
        fc.assert(
            fc.property(fc.array(opArb, { minLength: 1, maxLength: 50 }), (ops) => {
                const holder = new CredentialHolder();
                let lastSet: GatewayCredentials | null = null;
                let hasBeenSet = false;

                for (const op of ops) {
                    if (op.type === "set") {
                        holder.set(op.creds);
                        lastSet = op.creds;
                        hasBeenSet = true;
                    } else {
                        const result = holder.get();
                        if (!hasBeenSet) {
                            expect(result).toBeNull();
                        } else {
                            expect(result).not.toBeNull();
                            expect(result).toBe(lastSet);
                        }
                    }
                }
            }),
            { numRuns: 100 },
        );
    });
});

describe("TokenRefresher", () => {
    const makeCreds = (expiresAt: number): GatewayCredentials => ({
        bearerToken: "tok-123",
        cookie: "session=abc",
        userAgent: "TestAgent/1.0",
        expiresAt,
    });

    const makeCapturedCreds = (expiresAt: number) => ({
        bearerToken: "tok-new",
        cookie: "session=new",
        userAgent: "TestAgent/1.0",
        expiresAt,
    });

    beforeEach(() => {
        vi.useFakeTimers();
        mockCapture.mockReset();
        mockUpdateConfig.mockReset();
        mockUpdateConfig.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("checkAndRefresh returns false when no credentials are set", async () => {
        const holder = new CredentialHolder();
        const refresher = new TokenRefresher(holder, "http://localhost:9222");
        expect(await refresher.checkAndRefresh()).toBe(false);
    });

    it("checkAndRefresh returns false when credentials have no expiresAt", async () => {
        const holder = new CredentialHolder();
        holder.set({ bearerToken: "t", cookie: "c", userAgent: "u" });
        const refresher = new TokenRefresher(holder, "http://localhost:9222");
        expect(await refresher.checkAndRefresh()).toBe(false);
    });

    it("checkAndRefresh returns false when token is not near expiry", async () => {
        const holder = new CredentialHolder();
        const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
        holder.set(makeCreds(futureExpiry));
        const refresher = new TokenRefresher(holder, "http://localhost:9222");
        expect(await refresher.checkAndRefresh()).toBe(false);
        expect(mockCapture).not.toHaveBeenCalled();
    });

    it("checkAndRefresh refreshes when token is near expiry", async () => {
        const holder = new CredentialHolder();
        const nearExpiry = Math.floor(Date.now() / 1000) + 120;
        holder.set(makeCreds(nearExpiry));

        const newExpiry = Math.floor(Date.now() / 1000) + 7200;
        mockCapture.mockResolvedValueOnce(makeCapturedCreds(newExpiry));

        const refresher = new TokenRefresher(holder, "http://localhost:9222");
        const result = await refresher.checkAndRefresh();

        expect(result).toBe(true);
        expect(mockCapture).toHaveBeenCalledWith("http://localhost:9222");
        expect(holder.get()?.bearerToken).toBe("tok-new");
        expect(mockUpdateConfig).toHaveBeenCalledOnce();
    });

    it("retries on failure with backoff and returns false after exhausting retries", async () => {
        const holder = new CredentialHolder();
        const nearExpiry = Math.floor(Date.now() / 1000) + 120;
        holder.set(makeCreds(nearExpiry));

        mockCapture.mockRejectedValue(new Error("CDP connection failed"));

        const refresher = new TokenRefresher(holder, "http://localhost:9222", {
            maxRetries: 3,
        });

        const refreshPromise = refresher.checkAndRefresh();

        // Advance past first backoff (5s)
        await vi.advanceTimersByTimeAsync(5_000);
        // Advance past second backoff (15s)
        await vi.advanceTimersByTimeAsync(15_000);

        const result = await refreshPromise;
        expect(result).toBe(false);
        expect(mockCapture).toHaveBeenCalledTimes(3);
        expect(holder.get()?.bearerToken).toBe("tok-123");
    });

    it("start() sets up interval that calls checkAndRefresh", async () => {
        const holder = new CredentialHolder();
        const refresher = new TokenRefresher(holder, "http://localhost:9222", {
            checkIntervalMs: 1000,
        });

        const spy = vi.spyOn(refresher, "checkAndRefresh");

        refresher.start();
        expect(spy).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1000);
        expect(spy).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1000);
        expect(spy).toHaveBeenCalledTimes(2);

        refresher.stop();

        await vi.advanceTimersByTimeAsync(1000);
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it("start() is idempotent — calling twice does not create duplicate intervals", async () => {
        const holder = new CredentialHolder();
        const refresher = new TokenRefresher(holder, "http://localhost:9222", {
            checkIntervalMs: 1000,
        });
        const spy = vi.spyOn(refresher, "checkAndRefresh");

        refresher.start();
        refresher.start();

        await vi.advanceTimersByTimeAsync(1000);
        expect(spy).toHaveBeenCalledTimes(1);

        refresher.stop();
    });

    it("stop() is safe to call when not started", () => {
        const holder = new CredentialHolder();
        const refresher = new TokenRefresher(holder, "http://localhost:9222");
        refresher.stop();
    });

    it("succeeds on retry after initial failure", async () => {
        const holder = new CredentialHolder();
        const nearExpiry = Math.floor(Date.now() / 1000) + 120;
        holder.set(makeCreds(nearExpiry));

        const newExpiry = Math.floor(Date.now() / 1000) + 7200;
        mockCapture
            .mockRejectedValueOnce(new Error("Transient failure"))
            .mockResolvedValueOnce(makeCapturedCreds(newExpiry));

        const refresher = new TokenRefresher(holder, "http://localhost:9222");

        const refreshPromise = refresher.checkAndRefresh();
        await vi.advanceTimersByTimeAsync(5_000);

        const result = await refreshPromise;
        expect(result).toBe(true);
        expect(mockCapture).toHaveBeenCalledTimes(2);
        expect(holder.get()?.bearerToken).toBe("tok-new");
    });
});
