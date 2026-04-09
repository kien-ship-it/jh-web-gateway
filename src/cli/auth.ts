/**
 * `auth` command — re-capture JH credentials without full setup wizard.
 */
import { loadConfig } from "../infra/config.js";
import { captureCredentials, getTokenExpiry } from "../core/auth-capture.js";

function formatExpiry(exp: number): string {
  if (exp === 0) {return "unknown";}
  return new Date(exp * 1000).toLocaleString();
}

export async function runAuth(): Promise<void> {
  const config = await loadConfig();

  console.log(`Connecting to Chrome at ${config.cdpUrl}…`);
  console.log(
    "Opening chat.ai.jh.edu. Send any message to trigger auth capture (timeout: 120s)…"
  );

  const creds = await captureCredentials(config.cdpUrl, 120_000);
  const expiry = getTokenExpiry(creds.bearerToken);

  console.log("Credentials captured successfully.");
  console.log(`Token expires: ${formatExpiry(expiry)}`);
}
