import { randomBytes } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { GatewayConfig } from "./types.js";

/** Generate a random gateway API key prefixed with "jh-local-". */
export function generateApiKey(): string {
  return `jh-local-${randomBytes(16).toString("hex")}`;
}

/**
 * Hono middleware that validates the Authorization header against the config.
 *
 * - mode "none": all requests pass through
 * - mode "bearer": requires `Authorization: Bearer <token>`
 * - mode "basic": requires `Authorization: Basic <base64("gateway:<token>")>`
 */
export function authMiddleware(config: GatewayConfig): MiddlewareHandler {
  return async (c, next) => {
    const { mode, token } = config.auth;

    if (mode === "none") {
      return next();
    }

    const authHeader = c.req.header("authorization");
    if (!authHeader) {
      return c.json(
        {
          error: {
            message: "Missing Authorization header",
            type: "authentication_error",
            code: "missing_auth",
            param: null,
          },
        },
        401,
      );
    }

    if (mode === "bearer") {
      const expected = `Bearer ${token}`;
      if (!safeEquals(authHeader, expected)) {
        return c.json(
          {
            error: {
              message: "Invalid bearer token",
              type: "authentication_error",
              code: "invalid_auth",
              param: null,
            },
          },
          401,
        );
      }
    } else if (mode === "basic") {
      // Expect Basic base64("gateway:<token>")
      const expected = `Basic ${Buffer.from(`gateway:${token}`).toString("base64")}`;
      if (!safeEquals(authHeader, expected)) {
        return c.json(
          {
            error: {
              message: "Invalid basic credentials",
              type: "authentication_error",
              code: "invalid_auth",
              param: null,
            },
          },
          401,
        );
      }
    }

    return next();
  };
}

function safeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
