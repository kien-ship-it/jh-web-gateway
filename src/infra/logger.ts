import { appendFile, readFile, readdir, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RequestLogEntry } from "./types.js";

const DEFAULT_LOG_DIR = join(homedir(), ".jh-gateway", "logs");

/** Format a Date as YYYY-MM-DD for daily log file rotation. */
function dateStamp(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export class Logger {
  private logDir: string;
  private dirCreated = false;

  constructor(logDir?: string) {
    this.logDir = logDir ?? DEFAULT_LOG_DIR;
  }

  /** Ensure the log directory exists (lazy, once per instance). */
  private async ensureDir(): Promise<void> {
    if (this.dirCreated) {return;}
    await mkdir(this.logDir, { recursive: true });
    this.dirCreated = true;
  }

  /** Append a log entry to today's JSONL file. */
  async log(entry: RequestLogEntry): Promise<void> {
    await this.ensureDir();
    const file = join(this.logDir, `${dateStamp()}.jsonl`);
    await appendFile(file, JSON.stringify(entry) + "\n", "utf8");
  }

  /** Query log entries. Reads from a specific date or the most recent file. */
  async query(options: { date?: string; limit?: number } = {}): Promise<RequestLogEntry[]> {
    await this.ensureDir();
    const limit = options.limit ?? 100;

    if (options.date) {
      return this.readLogFile(join(this.logDir, `${options.date}.jsonl`), limit);
    }

    // Read from most recent files until we have enough entries
    let names: string[];
    try {
      names = await readdir(this.logDir);
    } catch {
      return [];
    }

    const jsonlFiles = names
      .filter((n) => n.endsWith(".jsonl"))
      .toSorted()
      .toReversed();

    const entries: RequestLogEntry[] = [];
    for (const name of jsonlFiles) {
      if (entries.length >= limit) {break;}
      const batch = await this.readLogFile(join(this.logDir, name), limit - entries.length);
      entries.push(...batch);
    }

    return entries.slice(0, limit);
  }

  private async readLogFile(filePath: string, limit: number): Promise<RequestLogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      return [];
    }

    const entries: RequestLogEntry[] = [];
    const lines = raw.split("\n");
    // Read from end for most-recent-first
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
      const line = lines[i].trim();
      if (!line) {continue;}
      try {
        entries.push(JSON.parse(line) as RequestLogEntry);
      } catch {
        // Skip malformed lines
      }
    }
    return entries;
  }
}
