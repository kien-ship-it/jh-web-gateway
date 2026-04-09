/**
 * FIFO promise queue that serializes async tasks so only one executes at a time.
 * Rejects with a 429-style error when queue wait exceeds maxWaitMs.
 */
export class RequestQueue {
  private queue: Array<() => void> = [];
  private running = false;
  private maxWaitMs: number;

  constructor(maxWaitMs: number = 120_000) {
    this.maxWaitMs = maxWaitMs;
  }

  /** Current number of tasks waiting in the queue (not including the active one). */
  get pending(): number {
    return this.queue.length;
  }

  /** Enqueue a task. Resolves when the task completes. Rejects on timeout or task error. */
  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    // Wait for our turn
    await this.waitForTurn();

    try {
      return await task();
    } finally {
      // Adaptive cooldown: only delay if there are queued requests waiting.
      // The JH platform needs a brief pause between generations, but 1500ms
      // was overly conservative. 300ms is enough for cleanup.
      if (this.queue.length > 0) {
        await new Promise((r) => setTimeout(r, 300));
      }
      this.release();
    }
  }

  private waitForTurn(): Promise<void> {
    if (!this.running) {
      this.running = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove ourselves from the queue
        const idx = this.queue.indexOf(release);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(
          Object.assign(
            new Error(
              `Request queue wait exceeded ${this.maxWaitMs}ms — server is overloaded`,
            ),
            { statusCode: 429 },
          ),
        );
      }, this.maxWaitMs);

      const release = () => {
        clearTimeout(timer);
        resolve();
      };

      this.queue.push(release);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.running = false;
    }
  }
}
