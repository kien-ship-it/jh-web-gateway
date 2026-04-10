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
import { runStart } from "./cli/start.js";

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
  start              Launch Chrome, authenticate, and start the gateway server
  setup              Interactive setup wizard (Chrome detection, auth, port)
  serve              Start the HTTP server
  auth               Re-capture JH credentials
  config             Print current configuration (credentials redacted)
  status             Show Chrome connection, token expiry, and gateway state
  logs               Display recent request logs

Options:
  start --headless   Launch Chrome in headless mode
  start --port <n>   Override the configured port
  start --pages <n>  Max concurrent browser pages (default: 1)
  serve --port <n>   Override the configured port
  serve --pages <n>  Max concurrent browser pages (default: 1)
  logs  --limit <n>  Number of log entries to show (default: 50)
  --version, -v      Print version and exit
  --help             Show this help message
`);
}

async function main(): Promise<void> {
  if (command === "--version" || command === "-v") {
    console.log(__APP_VERSION__);
    process.exit(0);
  }

  if (command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (!command || command === "tui") {
    const { launchTui } = await import("./tui/index.js");
    await launchTui();
    return;
  }

  const flags = parseFlags(args.slice(1));

  try {
    switch (command) {
      case "start": {
        const headless = flags["headless"] === true;
        const startPortFlag = flags["port"];
        const startPort =
          startPortFlag !== undefined && startPortFlag !== true
            ? Number(startPortFlag)
            : undefined;
        if (startPort !== undefined && (isNaN(startPort) || startPort < 1 || startPort > 65535)) {
          console.error("Error: --port must be a valid port number (1–65535)");
          process.exit(1);
        }
        const startPagesFlag = flags["pages"];
        const startPages =
          startPagesFlag !== undefined && startPagesFlag !== true
            ? Number(startPagesFlag)
            : undefined;
        if (startPages !== undefined && (isNaN(startPages) || startPages < 1 || startPages > 10)) {
          console.error("Error: --pages must be between 1 and 10");
          process.exit(1);
        }
        await runStart({ headless, port: startPort, pages: startPages });
        break;
      }

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
        const pagesFlag = flags["pages"];
        const pages =
          pagesFlag !== undefined && pagesFlag !== true
            ? Number(pagesFlag)
            : undefined;
        if (pages !== undefined && (isNaN(pages) || pages < 1 || pages > 10)) {
          console.error("Error: --pages must be between 1 and 10");
          process.exit(1);
        }
        await runServe({ port, pages });
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
