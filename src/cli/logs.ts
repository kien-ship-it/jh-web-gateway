/**
 * `logs` command — query and display recent request logs.
 */
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RequestLogEntry } from "../infra/types.js";

const LOG_DIR = join(homedir(), ".jh-gateway", "logs");

async function readLogFile(filePath: string): Promise<RequestLogEntry[]> {
  const raw = await readFile(filePath, "utf8");
  const entries: RequestLogEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {continue;}
    try {
      entries.push(JSON.parse(trimmed) as RequestLogEntry);
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

export async function runLogs(options: { limit?: number }): Promise<void> {
  const limit = options.limit ?? 50;

  let files: string[];
  try {
    const names = await readdir(LOG_DIR);
    // Sort descending (newest first) by filename (YYYY-MM-DD.jsonl)
    files = names
      .filter((n) => n.endsWith(".jsonl"))
      .toSorted()
      .toReversed()
      .map((n) => join(LOG_DIR, n));
  } catch {
    console.log("No log files found. Logs are written once the server handles requests.");
    return;
  }

  const entries: RequestLogEntry[] = [];
  for (const file of files) {
    if (entries.length >= limit) {break;}
    try {
      const fileEntries = await readLogFile(file);
      entries.push(...fileEntries);
    } catch {
      // Skip unreadable files
    }
  }

  // Take the most recent `limit` entries (files are sorted newest-first,
  // but entries within a file are oldest-first — reverse within each file)
  const recent = entries.slice(-limit).toReversed();

  if (recent.length === 0) {
    console.log("No log entries found.");
    return;
  }

  for (const entry of recent) {
    const tokens = `${entry.estimatedTokens.prompt}p/${entry.estimatedTokens.completion}c`;
    console.log(
      `${entry.timestamp}  ${entry.method.padEnd(4)} ${entry.path.padEnd(30)} ` +
        `${String(entry.statusCode).padEnd(4)} ${String(entry.latencyMs).padStart(6)}ms  ` +
        `${(entry.model ?? "-").padEnd(20)} tokens:${tokens}`
    );
  }
}
