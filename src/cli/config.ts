/**
 * `config` command — print current configuration with credentials redacted.
 */
import { loadConfig } from "../infra/config.js";
import type { GatewayConfig } from "../infra/types.js";

function redactConfig(config: GatewayConfig): Record<string, unknown> {
  return {
    cdpUrl: config.cdpUrl,
    port: config.port,
    defaultModel: config.defaultModel,
    defaultEndpoint: config.defaultEndpoint,
    credentials:
      config.credentials !== null
        ? {
            bearerToken: "[REDACTED]",
            cookie: "[REDACTED]",
            userAgent: config.credentials.userAgent,
          }
        : null,
    auth: {
      mode: config.auth.mode,
      token: config.auth.token !== null ? "[REDACTED]" : null,
    },
    maxQueueWaitMs: config.maxQueueWaitMs,
  };
}

export async function runConfig(): Promise<void> {
  const config = await loadConfig();
  const redacted = redactConfig(config);
  console.log(JSON.stringify(redacted, null, 2));
}
