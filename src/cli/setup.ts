/**
 * Interactive TUI setup wizard.
 * Steps: Chrome detection → JH auth → port selection → verify
 */
import * as p from "@clack/prompts";
import { getChromeWebSocketUrl } from "../infra/chrome-cdp.js";
import { captureCredentials, getTokenExpiry } from "../core/auth-capture.js";
import { loadConfig, updateConfig } from "../infra/config.js";
import { generateApiKey } from "../infra/gateway-auth.js";
import { MODEL_ENDPOINT_MAP } from "../infra/types.js";

const COMMON_CDP_PORTS = [9222, 9223];

/** Format a UNIX timestamp as a human-readable date string. */
function formatExpiry(exp: number): string {
  if (exp === 0) {return "unknown";}
  return new Date(exp * 1000).toLocaleString();
}

/** Step 1: Detect Chrome on common ports or prompt for custom URL. */
async function detectChrome(): Promise<string> {
  p.log.step("Step 1: Chrome detection");

  for (const port of COMMON_CDP_PORTS) {
    const url = `http://127.0.0.1:${port}`;
    const spinner = p.spinner();
    spinner.start(`Checking ${url}…`);
    try {
      await getChromeWebSocketUrl(url, 2000);
      spinner.stop(`Chrome found at ${url}`);
      return url;
    } catch {
      spinner.stop(`Not found at ${url}`);
    }
  }

  // Prompt for custom CDP URL
  const custom = await p.text({
    message: "Enter your Chrome CDP URL (e.g. http://127.0.0.1:9224):",
    placeholder: "http://127.0.0.1:9222",
    validate(value) {
      if (!value.startsWith("http://") && !value.startsWith("https://")) {
        return "Must be a valid URL starting with http:// or https://";
      }
    },
  });

  if (p.isCancel(custom)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Verify the custom URL
  const spinner = p.spinner();
  spinner.start(`Checking ${custom}…`);
  try {
    await getChromeWebSocketUrl(custom, 5000);
    spinner.stop(`Chrome found at ${custom}`);
    return custom;
  } catch (err) {
    spinner.stop(`Failed to connect to ${custom}`);
    throw err;
  }
}

/** Step 2: Capture JH credentials via CDP. */
async function captureAuth(cdpUrl: string): Promise<number> {
  p.log.step("Step 2: JH authentication");
  p.log.info(
    "Opening chat.ai.jh.edu in your browser. Send any message to trigger auth capture…"
  );

  const spinner = p.spinner();
  spinner.start("Waiting for credentials (up to 120s)…");

  const creds = await captureCredentials(cdpUrl, 120_000);
  const expiry = getTokenExpiry(creds.bearerToken);
  spinner.stop(`Credentials captured! Token expires: ${formatExpiry(expiry)}`);

  return expiry;
}

/** Step 3: Port selection. */
async function selectPort(): Promise<number> {
  p.log.step("Step 3: Port selection");

  const input = await p.text({
    message: "Gateway port:",
    placeholder: "8741",
    defaultValue: "8741",
    validate(value) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        return "Must be a valid port number (1–65535)";
      }
    },
  });

  if (p.isCancel(input)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  return Number(input);
}

/** Step 4: Verify by listing available models. */
async function verifyConnection(): Promise<void> {
  p.log.step("Step 4: Verification");
  const models = Object.keys(MODEL_ENDPOINT_MAP);
  p.log.success(`Available models: ${models.join(", ")}`);
}

/** Run the full setup wizard. */
export async function runSetup(): Promise<void> {
  p.intro("JH Web Gateway — Setup Wizard");

  let cdpUrl: string | undefined;
  let port = 8741;

  // Step 1: Chrome detection (with retry)
  while (true) {
    try {
      cdpUrl = await detectChrome();
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      p.log.error(`Chrome detection failed: ${msg}`);
      const retry = await p.confirm({ message: "Retry Chrome detection?" });
      if (p.isCancel(retry) || !retry) {
        p.cancel("Setup cancelled.");
        process.exit(1);
      }
    }
  }

  // Save CDP URL
  await updateConfig({ cdpUrl });

  // Step 2: Auth capture (with retry)
  while (true) {
    try {
      await captureAuth(cdpUrl);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      p.log.error(`Auth capture failed: ${msg}`);
      const retry = await p.confirm({ message: "Retry authentication?" });
      if (p.isCancel(retry) || !retry) {
        p.cancel("Setup cancelled.");
        process.exit(1);
      }
    }
  }

  // Step 3: Port selection
  try {
    port = await selectPort();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    p.log.error(`Port selection failed: ${msg}`);
    p.cancel("Setup cancelled.");
    process.exit(1);
  }

  // Generate API key and persist final config
  const apiKey = generateApiKey();
  await updateConfig({
    port,
    auth: { mode: "bearer", token: apiKey },
  });

  // Step 4: Verify
  await verifyConnection();

  // Load final config to confirm
  const config = await loadConfig();
  const baseUrl = `http://127.0.0.1:${config.port}`;

  p.outro("Setup complete!");

  console.log("\n  Base URL:  " + baseUrl);
  console.log("  API Key:   " + apiKey);
  console.log("\n  Test with curl:");
  console.log(
    `    curl ${baseUrl}/v1/models -H "Authorization: Bearer ${apiKey}"\n`
  );
}
