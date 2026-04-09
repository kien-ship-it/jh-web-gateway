#!/usr/bin/env node
/**
 * jh-gateway CLI entry point.
 * Registered as the `jh-gateway` bin in package.json.
 */
import { runSetup } from "./cli/setup.js";
import { runServe } from "./cli/serve.js";
import { runAuth } from "./cli/auth.js";
import { runConfig } from "./cli/config.js";
import { runStatus } from "./cli/status.js";
import { runLogs } from "./cli/logs.js";

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function printHelp(): void {
  console.log(`
jh-gateway — JH Web Gateway CLI

Usage:
  jh-gateway <command> [options]

Commands:
  setup              Interactive setup wizard (Chrome detection, auth, port)
  serve              Start the HTTP server
  auth               Re-capture JH credentials
  config             Print current configuration (credentials redacted)
  status             Show Chrome connection, token expiry, and gateway state
  logs               Display recent request logs

Options:
  serve --port <n>   Override the configured port
  logs  --limit <n>  Number of log entries to show (default: 50)
  --help             Show this help message
`);
}

async function main(): Promise<void> {
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  const flags = parseFlags(args.slice(1));

  try {
    switch (command) {
      case "setup":
        await runSetup();
        break;

      case "serve": {
        const portFlag = flags["port"];
        const port =
          portFlag !== undefined && portFlag !== true
            ? Number(portFlag)
            : undefined;
        if (port !== undefined && (isNaN(port) || port < 1 || port > 65535)) {
          console.error("Error: --port must be a valid port number (1–65535)");
          process.exit(1);
        }
        await runServe({ port });
        break;
      }

      case "auth":
        await runAuth();
        break;

      case "config":
        await runConfig();
        break;

      case "status":
        await runStatus();
        break;

      case "logs": {
        const limitFlag = flags["limit"];
        const limit =
          limitFlag !== undefined && limitFlag !== true
            ? Number(limitFlag)
            : undefined;
        if (limit !== undefined && (isNaN(limit) || limit < 1)) {
          console.error("Error: --limit must be a positive number");
          process.exit(1);
        }
        await runLogs({ limit });
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

main();
