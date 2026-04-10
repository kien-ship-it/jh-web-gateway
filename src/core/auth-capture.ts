import type { Browser, BrowserContext, Page } from "playwright-core";
import { connectToChrome } from "../infra/chrome-cdp.js";
import { updateConfig } from "../infra/config.js";
import type { CapturedCredentials } from "../infra/types.js";

const JH_HOST = "chat.ai.jh.edu";

function isJhUrl(url: string): boolean {
  try {
    return new URL(url).hostname === JH_HOST;
  } catch {
    return false;
  }
}

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
  const { browser } = await connectToChrome(cdpUrl);
  const browserTyped = browser as Browser;

  // Find an existing JH page, or create a blank page (don't navigate yet).
  let page: Page | undefined;
  for (const ctx of browserTyped.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes(JH_HOST)) {
        page = p;
        break;
      }
    }
    if (page) break;
  }

  if (!page) {
    const contexts = browserTyped.contexts();
    const context = contexts.length > 0 ? contexts[0] : await browserTyped.newContext();
    page = await context.newPage();
  }

  const targetPage = page;
  const routePattern = "**/*";

  return new Promise<CapturedCredentials>((resolve, reject) => {
    let settled = false;
    let cleanedUp = false;

    const routeHandler = async (route: import("playwright-core").Route) => {
      const request = route.request();
      const headers = await request.headers();

      const authHeader =
        headers["authorization"] ?? headers["Authorization"] ?? "";

      if (
        !settled &&
        authHeader.startsWith("Bearer ") &&
        isJhUrl(request.url())
      ) {
        try {
          const bearerToken = authHeader.slice("Bearer ".length).trim();

          // Collect cookies from the browser context.
          const rawCookies = await targetPage.context().cookies();
          const cookie = rawCookies
            .map((c) => `${c.name}=${c.value}`)
            .join("; ");

          // Capture the user agent from the page.
          const userAgent = await targetPage.evaluate(
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

          settleSuccess(captured);
        } catch (err) {
          settleFailure(err);
        }
      }

      // Always continue so the browser request is not blocked.
      await route.continue().catch(() => {
        // Best-effort: request may already be handled/aborted during teardown.
      });
    };

    const cleanup = async (): Promise<void> => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timer);
      await targetPage.unroute(routePattern, routeHandler).catch(() => {
        // Best-effort: page may be closing or route already removed.
      });
    };

    const settleSuccess = (captured: CapturedCredentials): void => {
      if (settled) return;
      settled = true;
      void cleanup().finally(() => resolve(captured));
    };

    const settleFailure = (err: unknown): void => {
      if (settled) return;
      settled = true;
      const error = err instanceof Error ? err : new Error(String(err));
      void cleanup().finally(() => reject(error));
    };

    const timer = setTimeout(() => {
      settleFailure(
        new Error(
          `Credential capture timed out after ${timeoutMs / 1000}s. ` +
            "Please log in to chat.ai.jh.edu and send a message to trigger authentication."
        )
      );
    }, timeoutMs);

    // Register route intercept FIRST, then navigate so we don't miss
    // Bearer-carrying requests from the initial page load.
    targetPage
      .route(routePattern, routeHandler)
      .then(() => {
        if (settled) return;
        // Route registered — now navigate to trigger auth requests.
        if (!isJhUrl(targetPage.url())) {
          targetPage.goto(`https://${JH_HOST}`, { waitUntil: "commit" }).catch(() => {});
        } else {
          // Already on JH — reload to trigger fresh API calls.
          targetPage.reload({ waitUntil: "commit" }).catch(() => {});
        }
      })
      .catch((err: unknown) => {
        settleFailure(err);
      });
  });
}

/**
 * Proactively capture credentials for background token refresh.
 *
 * Unlike captureCredentials() which waits passively for user interaction,
 * this opens a dedicated browser tab, navigates to the JH URL to trigger
 * the logged-in SPA's authenticated API calls, and captures the first
 * Bearer token seen. The dedicated tab is always closed when done.
 *
 * Throws if the JH session has expired (no Bearer calls appear) or on timeout.
 */
export async function captureCredentialsActive(
  cdpUrl: string,
  timeoutMs: number = 30_000
): Promise<CapturedCredentials> {
  const { browser } = await connectToChrome(cdpUrl);
  const browserTyped = browser as Browser;
  const contexts = browserTyped.contexts();
  const context: BrowserContext =
    contexts.length > 0 ? contexts[0] : await browserTyped.newContext();
  const page = await context.newPage();

  try {
    return await new Promise<CapturedCredentials>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            `Active credential capture timed out after ${timeoutMs / 1000}s. ` +
              "The JH session may have expired — restart without --headless to re-login."
          )
        );
      }, timeoutMs);

      page
        .route("**/*", async (route) => {
          const request = route.request();
          const headers = await request.headers();
          const authHeader =
            headers["authorization"] ?? headers["Authorization"] ?? "";

          if (
            !settled &&
            authHeader.startsWith("Bearer ") &&
            isJhUrl(request.url())
          ) {
            settled = true;
            clearTimeout(timer);

            try {
              const bearerToken = authHeader.slice("Bearer ".length).trim();
              const rawCookies = await page.context().cookies();
              const cookie = rawCookies
                .map((c) => `${c.name}=${c.value}`)
                .join("; ");
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
              await updateConfig({ credentials: captured });
              resolve(captured);
            } catch (err) {
              reject(err);
            }
          }

          await route.continue().catch(() => {});
        })
        .then(() => {
          // Route registered — navigate to JH to trigger the SPA's auth API calls
          page
            .goto(`https://${JH_HOST}`, { waitUntil: "commit" })
            .catch(() => {});
        })
        .catch((err: unknown) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        });
    });
  } finally {
    await page.close().catch(() => {});
  }
}
