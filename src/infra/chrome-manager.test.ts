import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import type { Browser } from "playwright-core";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock node:fs — existsSync
vi.mock("node:fs", () => ({
    existsSync: vi.fn(() => false),
}));

// Mock node:child_process — execSync and spawn
vi.mock("node:child_process", () => ({
    execSync: vi.fn(() => {
        throw new Error("not found");
    }),
    spawn: vi.fn(),
}));

// Mock playwright-core
vi.mock("playwright-core", () => ({
    chromium: {
        connectOverCDP: vi.fn(),
    },
}));

// Mock chrome-cdp
vi.mock("./chrome-cdp.js", () => ({
    getChromeWebSocketUrl: vi.fn(),
}));

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { ChromeManager } from "./chrome-manager.js";
import { getChromeWebSocketUrl } from "./chrome-cdp.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;
const mockGetChromeWebSocketUrl = getChromeWebSocketUrl as ReturnType<typeof vi.fn>;


// ── findChromePath tests ──────────────────────────────────────────────────────

describe("ChromeManager.findChromePath()", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, "platform", { value: originalPlatform });
        vi.restoreAllMocks();
    });

    beforeEach(() => {
        mockExistsSync.mockReturnValue(false);
        mockExecSync.mockImplementation(() => {
            throw new Error("not found");
        });
    });

    it("returns macOS Chrome path when it exists", () => {
        Object.defineProperty(process, "platform", { value: "darwin" });
        mockExistsSync.mockReturnValue(true);

        const result = ChromeManager.findChromePath();
        expect(result).toBe(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        );
    });

    it("returns null on macOS when Chrome is not installed", () => {
        Object.defineProperty(process, "platform", { value: "darwin" });
        mockExistsSync.mockReturnValue(false);

        expect(ChromeManager.findChromePath()).toBeNull();
    });

    it("returns the first found Linux Chrome candidate via which", () => {
        Object.defineProperty(process, "platform", { value: "linux" });
        // First candidate fails, second succeeds
        mockExecSync
            .mockImplementationOnce(() => {
                throw new Error("not found");
            })
            .mockReturnValueOnce("/usr/bin/google-chrome-stable\n");

        const result = ChromeManager.findChromePath();
        expect(result).toBe("/usr/bin/google-chrome-stable");
    });

    it("returns null on Linux when no Chrome candidate is found", () => {
        Object.defineProperty(process, "platform", { value: "linux" });
        mockExecSync.mockImplementation(() => {
            throw new Error("not found");
        });

        expect(ChromeManager.findChromePath()).toBeNull();
    });

    it("returns the first found Windows Chrome path", () => {
        Object.defineProperty(process, "platform", { value: "win32" });
        // First path not found, second exists
        mockExistsSync
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);

        const result = ChromeManager.findChromePath();
        expect(result).toBe(
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        );
    });

    it("returns null on Windows when Chrome is not installed", () => {
        Object.defineProperty(process, "platform", { value: "win32" });
        mockExistsSync.mockReturnValue(false);

        expect(ChromeManager.findChromePath()).toBeNull();
    });

    it("returns null for unsupported platforms", () => {
        Object.defineProperty(process, "platform", { value: "freebsd" });

        expect(ChromeManager.findChromePath()).toBeNull();
    });
});

// ── shutdown tests ────────────────────────────────────────────────────────────

describe("ChromeManager.shutdown()", () => {
    it("kills the process with SIGTERM when selfLaunched is true", async () => {
        const manager = new ChromeManager();
        const killSpy = vi.fn();
        const mockBrowser = { close: vi.fn().mockResolvedValue(undefined) } as unknown as Browser;
        const mockProcess = { kill: killSpy } as unknown as ChildProcess;

        await manager.shutdown({
            browser: mockBrowser,
            selfLaunched: true,
            process: mockProcess,
        });

        expect(mockBrowser.close).toHaveBeenCalled();
        expect(killSpy).toHaveBeenCalledWith("SIGTERM");
    });

    it("does NOT kill the process when selfLaunched is false", async () => {
        const manager = new ChromeManager();
        const killSpy = vi.fn();
        const mockBrowser = { close: vi.fn() } as unknown as Browser;
        const mockProcess = { kill: killSpy } as unknown as ChildProcess;

        await manager.shutdown({
            browser: mockBrowser,
            selfLaunched: false,
            process: mockProcess,
        });

        expect(mockBrowser.close).not.toHaveBeenCalled();
        expect(killSpy).not.toHaveBeenCalled();
    });

    it("handles browser.close() throwing gracefully", async () => {
        const manager = new ChromeManager();
        const killSpy = vi.fn();
        const mockBrowser = {
            close: vi.fn().mockRejectedValue(new Error("already disconnected")),
        } as unknown as Browser;
        const mockProcess = { kill: killSpy } as unknown as ChildProcess;

        // Should not throw
        await manager.shutdown({
            browser: mockBrowser,
            selfLaunched: true,
            process: mockProcess,
        });

        expect(killSpy).toHaveBeenCalledWith("SIGTERM");
    });
});

// ── connect error test ────────────────────────────────────────────────────────

describe("ChromeManager.connect() — no Chrome found", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, "platform", { value: originalPlatform });
        vi.restoreAllMocks();
    });

    it("throws a descriptive error when no Chrome executable is found", async () => {
        Object.defineProperty(process, "platform", { value: "darwin" });
        mockExistsSync.mockReturnValue(false);
        mockExecSync.mockImplementation(() => {
            throw new Error("not found");
        });

        // getChromeWebSocketUrl should throw to simulate no existing Chrome
        mockGetChromeWebSocketUrl.mockRejectedValue(
            new Error("Chrome is not running"),
        );

        const manager = new ChromeManager();

        await expect(manager.connect()).rejects.toThrow(
            /Chrome executable not found/,
        );
        await expect(manager.connect()).rejects.toThrow(
            /Please install Google Chrome/,
        );
    });
});
