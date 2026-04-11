/**
 * Pure TypeScript request activity tracker — no React dependency.
 * Maintains the canonical list of HTTP request entries, enforces a bounded
 * retention limit, and exposes state via a subscription model.
 */

export type RequestStatus = "active" | "completed" | "error";

export interface RequestEntry {
    id: string;
    method: string;
    path: string;
    status: RequestStatus;
    statusCode: number | null;
    startTime: number;
    endTime: number | null;
    elapsedMs: number | null;
}

export type TrackerListener = (entries: ReadonlyArray<RequestEntry>) => void;

export class RequestActivityTracker {
    private entries: Map<string, RequestEntry> = new Map();
    private orderedIds: string[] = [];
    private listeners: Set<TrackerListener> = new Set();
    private maxCompleted: number;

    constructor(maxCompleted: number = 50) {
        this.maxCompleted = maxCompleted;
    }

    /** Called by middleware when a request arrives. */
    start(id: string, method: string, path: string): void {
        if (this.entries.has(id)) return;

        const entry: RequestEntry = {
            id,
            method,
            path,
            status: "active",
            statusCode: null,
            startTime: Date.now(),
            endTime: null,
            elapsedMs: null,
        };

        this.entries.set(id, entry);
        this.orderedIds.unshift(id);
        this.notify();
    }

    /** Called by middleware when a response is sent. */
    end(id: string, statusCode: number): void {
        const entry = this.entries.get(id);
        if (!entry) return;

        const endTime = Date.now();
        entry.status = statusCode >= 200 && statusCode < 300 ? "completed" : "error";
        entry.statusCode = statusCode;
        entry.endTime = endTime;
        entry.elapsedMs = endTime - entry.startTime;

        this.prune();
        this.notify();
    }

    /** Subscribe to state changes. Returns unsubscribe function. */
    subscribe(listener: TrackerListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Get current snapshot of entries (most-recent-first). */
    getEntries(): ReadonlyArray<RequestEntry> {
        return this.orderedIds
            .map((id) => this.entries.get(id)!)
            .filter(Boolean);
    }

    /** Get a single entry by ID. */
    getEntry(id: string): RequestEntry | undefined {
        return this.entries.get(id);
    }

    /** Clear all entries. */
    clear(): void {
        this.entries.clear();
        this.orderedIds = [];
        this.notify();
    }

    /** Notify all listeners with current entries snapshot. */
    private notify(): void {
        const snapshot = this.getEntries();
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            } catch (err) {
                console.error("[RequestActivityTracker] subscriber error:", err);
            }
        }
    }

    /** Remove oldest completed entries beyond maxCompleted. */
    private prune(): void {
        const completed = this.orderedIds.filter((id) => {
            const e = this.entries.get(id);
            return e && e.status !== "active";
        });

        while (completed.length > this.maxCompleted) {
            const oldestId = completed.pop()!;
            this.entries.delete(oldestId);
            const idx = this.orderedIds.indexOf(oldestId);
            if (idx !== -1) this.orderedIds.splice(idx, 1);
        }
    }
}

// ── Formatting utilities ──────────────────────────────────────────────

/** Convert milliseconds to "X.Xs" format (e.g., 3200 → "3.2s"). */
export function formatElapsed(ms: number): string {
    const seconds = Math.round(ms / 100) / 10;
    return `${seconds.toFixed(1)}s`;
}

/** Format queue depth for display. */
export function formatQueueDepth(n: number, online: boolean): string {
    if (!online) return "Queue: offline";
    if (n === 0) return "Queue: idle";
    return `Queue: ${n} pending`;
}
