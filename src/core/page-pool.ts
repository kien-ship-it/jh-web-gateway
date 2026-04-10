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

    constructor(options: {
        targetUrl?: string;
        maxPages?: number;
        maxWaitMs?: number;
    } = {}) {
        this.targetUrl = options.targetUrl ?? "https://chat.ai.jh.edu";
        this.maxPages = options.maxPages ?? 3;
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
     */
    async acquire(): Promise<{ page: Page; queue: RequestQueue; release: () => void }> {
        // First, try to find an available (non-busy) page
        let pooled = this.pages.find(p => !p.inUse);

        // If all pages are busy and we haven't hit max, create a new one.
        // Include pagesCreating in the capacity check to prevent concurrent over-creation.
        if (!pooled && (this.pages.length + this.pagesCreating) < this.maxPages && this.browser) {
            this.pagesCreating++;
            try {
                pooled = await this.createPage();
            } finally {
                this.pagesCreating--;
            }
        }

        // If still no page available, pick the one with the smallest queue
        if (!pooled) {
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
            },
        };
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
            await page.goto(this.targetUrl, { waitUntil: "networkidle", timeout: 30_000 });

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
