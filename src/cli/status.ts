/**
 * `status` command — display Chrome connection status, token expiry, gateway state.
 */
import { loadConfig } from "../infra/config.js";
import { getChromeWebSocketUrl } from "../infra/chrome-cdp.js";
import { getTokenExpiry } from "../core/auth-capture.js";
import { isTokenExpired } from "../core/client.js";

function formatExpiry(exp: number): string {
  if (exp === 0) {return "unknown";}
  return new Date(exp * 1000).toLocaleString();
}

export async function runStatus(): Promise<void> {
  const config = await loadConfig();

  // Chrome connection status
  let chromeStatus: string;
  try {
    await getChromeWebSocketUrl(config.cdpUrl, 3000);
    chromeStatus = `connected (${config.cdpUrl})`;
  } catch {
    chromeStatus = `disconnected (${config.cdpUrl})`;
  }

  // Token expiry
  let tokenStatus: string;
  if (!config.credentials) {
    tokenStatus = "no credentials stored";
  } else {
    const exp = getTokenExpiry(config.credentials.bearerToken);
    const expired = isTokenExpired(config.credentials.bearerToken);
    tokenStatus = expired
      ? `expired at ${formatExpiry(exp)}`
      : `valid until ${formatExpiry(exp)}`;
  }

  // Gateway running state — check if something is listening on the configured port
  let gatewayStatus: string;
  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      gatewayStatus = `running on port ${config.port}`;
    } else {
      gatewayStatus = `port ${config.port} responded with ${res.status}`;
    }
  } catch {
    gatewayStatus = `not running (port ${config.port})`;
  }

  console.log(`Chrome:  ${chromeStatus}`);
  console.log(`Token:   ${tokenStatus}`);
  console.log(`Gateway: ${gatewayStatus}`);
}
