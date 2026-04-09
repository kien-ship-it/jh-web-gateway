import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GatewayConfig } from "./types.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

export function getConfigPath(): string {
  return join(homedir(), ".jh-gateway", "config.json");
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export function getDefaultConfig(): GatewayConfig {
  return {
    cdpUrl: "http://127.0.0.1:9222",
    port: 8741,
    defaultModel: "claude-opus-4.5",
    defaultEndpoint: "AnthropicClaude",
    credentials: null,
    auth: { mode: "none", token: null },
    maxQueueWaitMs: 120000,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateConfig(raw: unknown): GatewayConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Config validation error: config must be a JSON object");
  }

  const c = raw as Record<string, unknown>;

  // cdpUrl
  if (typeof c.cdpUrl !== "string" || !/^https?:\/\//.test(c.cdpUrl)) {
    throw new Error(
      "Config validation error: cdpUrl must be a valid URL starting with http:// or https://"
    );
  }

  // port
  if (
    typeof c.port !== "number" ||
    !Number.isInteger(c.port) ||
    c.port < 1 ||
    c.port > 65535
  ) {
    throw new Error(
      "Config validation error: port must be between 1 and 65535"
    );
  }

  // defaultModel
  if (typeof c.defaultModel !== "string" || c.defaultModel.trim() === "") {
    throw new Error(
      "Config validation error: defaultModel must be a non-empty string"
    );
  }

  // defaultEndpoint
  if (
    typeof c.defaultEndpoint !== "string" ||
    c.defaultEndpoint.trim() === ""
  ) {
    throw new Error(
      "Config validation error: defaultEndpoint must be a non-empty string"
    );
  }

  // credentials
  if (c.credentials !== null && c.credentials !== undefined) {
    if (typeof c.credentials !== "object" || Array.isArray(c.credentials)) {
      throw new Error(
        "Config validation error: credentials must be null or an object with bearerToken, cookie, and userAgent strings"
      );
    }
    const creds = c.credentials as Record<string, unknown>;
    for (const field of ["bearerToken", "cookie", "userAgent"] as const) {
      if (typeof creds[field] !== "string") {
        throw new Error(
          `Config validation error: credentials.${field} must be a string`
        );
      }
    }
  }

  // auth
  if (typeof c.auth !== "object" || c.auth === null || Array.isArray(c.auth)) {
    throw new Error(
      "Config validation error: auth must be an object with mode and token fields"
    );
  }
  const auth = c.auth as Record<string, unknown>;
  if (
    auth.mode !== "none" &&
    auth.mode !== "bearer" &&
    auth.mode !== "basic"
  ) {
    throw new Error(
      'Config validation error: auth.mode must be "none", "bearer", or "basic"'
    );
  }
  if (auth.token !== null && typeof auth.token !== "string") {
    throw new Error(
      "Config validation error: auth.token must be null or a string"
    );
  }

  // maxQueueWaitMs
  if (typeof c.maxQueueWaitMs !== "number" || c.maxQueueWaitMs <= 0) {
    throw new Error(
      "Config validation error: maxQueueWaitMs must be a positive number"
    );
  }

  return {
    cdpUrl: c.cdpUrl,
    port: c.port,
    defaultModel: c.defaultModel,
    defaultEndpoint: c.defaultEndpoint,
    credentials:
      c.credentials != null
        ? {
          bearerToken: (c.credentials as Record<string, unknown>).bearerToken as string,
          cookie: (c.credentials as Record<string, unknown>).cookie as string,
          userAgent: (c.credentials as Record<string, unknown>).userAgent as string,
          expiresAt: typeof (c.credentials as Record<string, unknown>).expiresAt === "number"
            ? ((c.credentials as Record<string, unknown>).expiresAt as number)
            : 0,
        }
        : null,
    auth: {
      mode: auth.mode,
      token: (auth.token) ?? null,
    },
    maxQueueWaitMs: c.maxQueueWaitMs,
  };
}

// ── I/O ───────────────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<GatewayConfig> {
  const configPath = getConfigPath();
  const configDir = join(homedir(), ".jh-gateway");

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err: unknown) {
    // File or directory missing — create with defaults
    if (isNodeError(err) && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      const defaults = getDefaultConfig();
      await mkdir(configDir, { recursive: true });
      await writeFile(configPath, JSON.stringify(defaults, null, 2), "utf8");
      return defaults;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Config validation error: config file at ${configPath} contains malformed JSON`
    );
  }

  return validateConfig(parsed);
}

export async function saveConfig(config: GatewayConfig): Promise<void> {
  const configPath = getConfigPath();
  const configDir = join(homedir(), ".jh-gateway");
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

export async function updateConfig(
  partial: Partial<GatewayConfig>
): Promise<void> {
  const current = await loadConfig();

  // Deep merge for nested `auth` object; shallow merge for everything else
  const updated: GatewayConfig = { ...current, ...partial };
  if (partial.auth !== undefined) {
    updated.auth = { ...current.auth, ...partial.auth };
  }

  await saveConfig(updated);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
