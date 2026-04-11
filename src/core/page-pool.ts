/**
 * Pool of browser pages for concurrent request handling.
 * Each page has its own RequestQueue (concurrency=1), but with N pages
 * we can handle N concurrent requests to the upstream.
 */
import type { Page, Browser } from "playwright-core";
import { RequestQueue } from "./request-queue.js";

export interface PooledPage {
    page: Page;
    queue: RequestQueue;
    inUse: boolean;
}

export class PagePool {
    private pages: PooledPage[] = [];
    private browser: Browser | null = null;
    private targetUrl: string;
    private maxPages: number;
    private maxWaitMs: number;
    private initPromise: Promise<void> | null = null;
    private pagesCreating = 0;
    private warmedUp = false;
    private disconnected = false;

    constructor(options: {
        targetUrl?: string;
        maxPages?: number;
        maxWaitMs?: number;
    } = {}) {
        this.targetUrl = options.targetUrl ?? "https://chat.ai.jh.edu";
        this.maxPages = options.maxPages ?? 1;
        this.maxWaitMs = options.maxWaitMs ?? 120_000;
    }

    /** Initialize the pool with an existing browser connection and seed page */
    async init(browser: Browser, seedPage: Page): Promise<void> {
        if (this.initPromise) return this.initPromise;

        this.initPromise = this._doInit(browser, seedPage);
        return this.initPromise;
    }

    private async _doInit(browser: Browser, seedPage: Page): Promise<void> {
        this.browser = browser;
        this.disconnected = false;

        // Detect CDP disconnection so we stop handing out dead pages
        browser.on("disconnected", () => {
            console.warn("[PagePool] Browser disconnected — all pages are now invalid");
            this.disconnected = true;
        });

        // Add the seed page as the first pooled page
        this.pages.push({
            page: seedPage,
            queue: new RequestQueue(this.maxWaitMs),
            inUse: false,
        });

        console.log(`[PagePool] Initialized with 1 page, will scale up to ${this.maxPages}`);
    }

    /** Get pool statistics */
    get stats(): { total: number; busy: number; available: number } {
        const busy = this.pages.filter(p => p.inUse).length;
        return {
            total: this.pages.length,
            busy,
            available: this.pages.length - busy,
        };
    }

    /**
     * Acquire a page for use. Creates new pages on-demand up to maxPages.
     * Note: We intentionally don't lock here — allowing multiple requests to
     * grab the same page and queue on it is actually faster than creating new pages.
     *
     * On first init (before any request succeeds), page scaling is disabled to
     * avoid opening new Chrome tabs that may redirect through SSO and hang.
     * Call `markWarmedUp()` after the first successful request to enable scaling.
     */
    async acquire(): Promise<{ page: Page; queue: RequestQueue; release: () => void }> {
        if (this.disconnected) {
            throw Object.assign(
                new Error("Browser has disconnected. Restart the gateway to reconnect."),
                { statusCode: 503 },
            );
        }

        // Evict dead/navigated-away pages before selecting
        this.evictDeadPages();

        // First, try to find an available (non-busy) page
        let pooled = this.pages.find(p => !p.inUse);

        // Only scale up if the pool is warmed up (first request has succeeded).
        // Before warm-up, queue on the seed page to avoid opening new tabs that
        // may redirect through SSO on a fresh session and hang visibly.
        if (!pooled && this.warmedUp && (this.pages.length + this.pagesCreating) < this.maxPages && this.browser) {
            this.pagesCreating++;
            try {
                pooled = await this.createPage();
            } finally {
                this.pagesCreating--;
            }
        }

        // If still no page available, pick the one with the smallest queue
        if (!pooled) {
            if (this.pages.length === 0) {
                throw Object.assign(
                    new Error("No healthy browser pages available. Restart the gateway."),
                    { statusCode: 503 },
                );
            }
            pooled = this.pages.reduce((a, b) =>
                a.queue.pending <= b.queue.pending ? a : b
            );
        }

        pooled.inUse = true;
        const p = pooled;

        return {
            page: p.page,
            queue: p.queue,
            release: () => {
                p.inUse = false;
                // Auto warm-up after the first successful release
                if (!this.warmedUp) {
                    this.warmedUp = true;
                    console.log(`[PagePool] Warm-up complete — page scaling enabled (max ${this.maxPages})`);
                    // Pre-warm a second page in the background if maxPages > 1
                    if (this.maxPages > 1 && this.pages.length < this.maxPages && this.browser) {
                        this.preWarmPage();
                    }
                }
            },
        };
    }

    /** Mark the pool as warmed up, enabling page scaling. */
    markWarmedUp(): void {
        if (!this.warmedUp) {
            this.warmedUp = true;
            console.log(`[PagePool] Warm-up complete — page scaling enabled (max ${this.maxPages})`);
        }
    }

    private async createPage(): Promise<PooledPage> {
        if (!this.browser) {
            throw new Error("PagePool not initialized");
        }

        console.log(`[PagePool] Creating new page (${this.pages.length + 1}/${this.maxPages})...`);

        const context = this.browser.contexts()[0];
        if (!context) {
            throw new Error("No browser context available");
        }

        const page = await context.newPage();

        try {
            // Navigate to the target URL
            await page.goto(this.targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

            // Verify we actually landed on the target domain and weren't redirected
            // to a login/auth page (goto() follows redirects silently).
            const finalUrl = page.url();
            if (!finalUrl.includes("chat.ai.jh.edu")) {
                throw new Error(
                    `New page redirected away from target: ${finalUrl} — ` +
                    "browser session may have expired, restart without --headless to re-login."
                );
            }

            console.log(`[PagePool] New page ready: ${finalUrl}`);

            const pooled: PooledPage = {
                page,
                queue: new RequestQueue(this.maxWaitMs),
                inUse: false,
            };

            this.pages.push(pooled);
            return pooled;
        } catch (err) {
            // Always close the tab on failure to avoid leaving orphaned browser tabs
            // that the user would have to close manually.
            await page.close().catch(() => {});
            throw err;
        }
    }

    /** Evict pages that have crashed or navigated away from JH */
    private evictDeadPages(): void {
        const before = this.pages.length;
        this.pages = this.pages.filter((p) => {
            try {
                // page.isClosed() is synchronous and safe
                if (p.page.isClosed()) return false;
                // Check the page is still on JH domain
                const url = p.page.url();
                if (!url.includes("chat.ai.jh.edu")) {
                    console.warn(`[PagePool] Evicting page — navigated away: ${url}`);
                    p.page.close().catch(() => {});
                    return false;
                }
                return true;
            } catch {
                // page reference is dead
                return false;
            }
        });
        const evicted = before - this.pages.length;
        if (evicted > 0) {
            console.warn(`[PagePool] Evicted ${evicted} dead/stale page(s)`);
        }
    }

    /** Pre-warm a new page in the background (fire-and-forget) */
    private preWarmPage(): void {
        this.pagesCreating++;
        this.createPage()
            .then(() => console.log("[PagePool] Pre-warmed a new page"))
            .catch((err) => console.warn(`[PagePool] Pre-warm failed: ${(err as Error).message}`))
            .finally(() => { this.pagesCreating--; });
    }

    /** Close all pages except the seed page */
    async drain(): Promise<void> {
        // Keep the first page (seed), close the rest
        const toClose = this.pages.slice(1);
        this.pages = this.pages.slice(0, 1);

        for (const p of toClose) {
            try {
                await p.page.close();
            } catch {
                // Page may already be closed
            }
        }

        console.log(`[PagePool] Drained ${toClose.length} pages`);
    }
}
