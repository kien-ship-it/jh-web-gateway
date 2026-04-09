import type { Browser } from "playwright-core";
import { connectToChrome, findOrOpenJhPage } from "../infra/chrome-cdp.js";
import { updateConfig } from "../infra/config.js";
import type { CapturedCredentials } from "../infra/types.js";

const JH_HOST = "chat.ai.jh.edu";

/**
 * Decode the JWT `exp` claim from the middle (payload) segment.
 * Returns 0 if decoding fails for any reason.
 */
export function getTokenExpiry(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return 0;

    // Base64url → base64 → decode
    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const json = Buffer.from(payload, "base64").toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;

    const exp = parsed["exp"];
    if (typeof exp !== "number") return 0;
    return exp;
  } catch {
    return 0;
  }
}

/**
 * Connect to Chrome via CDP, intercept outgoing requests to chat.ai.jh.edu,
 * capture the Bearer token, cookies, and user agent, then persist to config.
 *
 * Throws a descriptive message if no token is captured within `timeoutMs`.
 */
export async function captureCredentials(
  cdpUrl: string,
  timeoutMs: number = 120_000
): Promise<CapturedCredentials> {
  const { browser, page: _initialPage } = await connectToChrome(cdpUrl);

  // Find or open the JH page — we want to intercept on that specific page.
  const page = await findOrOpenJhPage(browser as Browser);

  return new Promise<CapturedCredentials>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Credential capture timed out after ${timeoutMs / 1000}s. ` +
            "Please log in to chat.ai.jh.edu and send a message to trigger authentication."
        )
      );
    }, timeoutMs);

    // Intercept all requests on the page and look for the Authorization header.
    page
      .route("**/*", async (route) => {
        // Always continue the request so we don't block the browser.
        const request = route.request();
        const headers = await request.headers();

        const authHeader =
          headers["authorization"] ?? headers["Authorization"] ?? "";

        if (
          !settled &&
          authHeader.startsWith("Bearer ") &&
          request.url().includes(JH_HOST)
        ) {
          settled = true;
          clearTimeout(timer);

          try {
            const bearerToken = authHeader.slice("Bearer ".length).trim();

            // Collect cookies from the browser context.
            const rawCookies = await page.context().cookies();
            const cookie = rawCookies
              .map((c) => `${c.name}=${c.value}`)
              .join("; ");

            // Capture the user agent from the page.
            const userAgent = await page.evaluate(
              () => navigator.userAgent
            );

            const expiresAt = getTokenExpiry(bearerToken);

            const captured: CapturedCredentials = {
              bearerToken,
              cookie,
              userAgent,
              expiresAt,
            };

            // Persist to config store (fire-and-forget; errors surface via reject).
            await updateConfig({ credentials: captured });

            resolve(captured);
          } catch (err) {
            reject(err);
          }
        }

        // Always continue so the browser request is not blocked.
        await route.continue();
      })
      .catch((err: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}
