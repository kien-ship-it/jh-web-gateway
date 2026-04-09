# Implementation Plan: Auto-Auth and Managed Chrome

## Overview

Transform the jh-web-gateway from a multi-terminal workflow into a single `jh-gateway start` command. Implementation proceeds bottom-up: core utilities first (ReauthLock, TokenRefresher), then ChromeManager, then the unified CLI command, and finally wiring into the existing server and routes.

## Tasks

- [x] 1. Add `expiresAt` to `GatewayCredentials` and implement `shouldRefresh` utility
  - [x] 1.1 Extend `GatewayCredentials` in `src/infra/types.ts` with optional `expiresAt?: number` field
    - Add `expiresAt` as an optional property so existing code that constructs `GatewayCredentials` without it continues to compile
    - Update `GatewayConfig.credentials` type to include the new field
    - _Requirements: 3.1, 7.2, 7.3_
  - [x] 1.2 Add `shouldRefresh(nowMs: number, expiresAt: number, thresholdMs: number): boolean` to `src/core/token-refresher.ts` (create file with just this function first)
    - Returns `true` iff `(expiresAt * 1000 - nowMs) < thresholdMs`
    - Export as a standalone pure function for easy testing
    - _Requirements: 3.2_
  - [x]* 1.3 Write property test for `shouldRefresh` — Property 1: Token refresh decision boundary
    - **Property 1: Token refresh decision boundary**
    - **Validates: Requirements 3.2**
    - Create `src/core/token-refresher.test.ts`
    - Generate random `(nowMs, expiresAt, thresholdMs)` tuples with fast-check
    - Assert `shouldRefresh` returns `true` iff `(expiresAt * 1000 - nowMs) < thresholdMs`
  - [x] 1.4 Update `src/infra/config.ts` `validateConfig` to accept and pass through `expiresAt` on credentials, and fill defaults for missing new fields
    - Ensure existing config files without `expiresAt` load successfully with `expiresAt` defaulting to `0`
    - _Requirements: 7.2, 7.3_
  - [x]* 1.5 Write property test for config backward compatibility — Property 5
    - **Property 5: Config backward compatibility with default filling**
    - **Validates: Requirements 7.2, 7.3**
    - Add tests to `src/infra/config.test.ts`
    - Generate valid GatewayConfig objects, remove random subsets of optional fields, verify `loadConfig` fills defaults

- [x] 2. Implement ReauthLock (`src/core/reauth-lock.ts`)
  - [x] 2.1 Create `ReauthLock` class with `acquire(recaptureFn)` method
    - When no re-capture is in progress, call `recaptureFn` and store the promise
    - When a re-capture is already in progress, return the existing promise
    - After the promise settles (resolve or reject), reset the lock so the next `acquire` starts fresh
    - _Requirements: 6.4_
  - [x]* 2.2 Write property test for ReauthLock deduplication — Property 4
    - **Property 4: ReauthLock deduplication**
    - **Validates: Requirements 6.4**
    - Create `src/core/reauth-lock.test.ts`
    - Generate random concurrency levels (2–50), fire N concurrent `acquire()` calls, verify `recaptureFn` called exactly once and all callers get the same result

- [x] 3. Implement CredentialHolder and TokenRefresher (`src/core/token-refresher.ts`)
  - [x] 3.1 Implement `CredentialHolder` class with `get()` / `set(creds)` methods
    - `get()` returns `GatewayCredentials | null`
    - `set()` atomically replaces the stored credentials
    - After the first `set()`, `get()` must never return `null`
    - _Requirements: 3.6_
  - [x]* 3.2 Write property test for CredentialHolder — Property 2: Credential holder read consistency
    - **Property 2: Credential holder read consistency**
    - **Validates: Requirements 3.6**
    - Generate random sequences of get/set operations, verify `get()` never returns `null` after first `set()`
  - [x] 3.3 Implement `TokenRefresher` class with `start()`, `stop()`, and `checkAndRefresh()` methods
    - Uses `setInterval` at `checkIntervalMs` (default 60s) to call `checkAndRefresh()`
    - `checkAndRefresh()` reads credentials from `CredentialHolder`, calls `shouldRefresh`, and if needed triggers re-capture via `captureCredentials`
    - On success: updates `CredentialHolder`, persists to config via `updateConfig`, logs refresh + new expiry
    - On failure: retries up to `maxRetries` (default 3) with backoff, then logs warning and continues
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement ChromeManager (`src/infra/chrome-manager.ts`)
  - [x] 5.1 Implement `ChromeManager.findChromePath()` static method
    - Detect OS via `process.platform`
    - macOS: check `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
    - Linux: search `google-chrome`, `google-chrome-stable`, `chromium-browser`, `chromium` via `which`
    - Windows: check `C:\Program Files\Google\Chrome\Application\chrome.exe` and `C:\Program Files (x86)\...`
    - Return path string or `null` if not found
    - _Requirements: 1.3, 1.6_
  - [x] 5.2 Implement `ChromeManager.connect()` method
    - First try connecting to existing Chrome at `cdpUrl` using `getChromeWebSocketUrl` + `chromium.connectOverCDP`
    - If connection succeeds, return `{ browser, selfLaunched: false }`
    - If connection fails, find Chrome path, spawn with `--remote-debugging-port`, `--user-data-dir`, `--no-first-run`, `--no-default-browser-check`, and optionally `--headless=new`
    - Wait for CDP to become available (poll `/json/version`), then connect via Playwright
    - Return `{ browser, selfLaunched: true, process }`
    - Throw descriptive error if Chrome not found
    - _Requirements: 1.1, 1.2, 1.3, 1.6_
  - [x] 5.3 Implement `shutdown()`, `reconnect()`, and `minimizeWindow()` methods
    - `shutdown(state)`: if `selfLaunched`, kill the child process; otherwise do nothing
    - `reconnect(state)`: attempt to relaunch and reconnect within 30s timeout
    - `minimizeWindow(state)`: use CDP session to send `Browser.setWindowBounds` with `minimized` state
    - _Requirements: 1.4, 1.5, 1.7, 5.1, 5.3_
  - [x]* 5.4 Write unit tests for ChromeManager
    - Test `findChromePath()` with mocked `process.platform` and filesystem checks
    - Test `shutdown()` only kills process when `selfLaunched` is true
    - Test descriptive error when no Chrome executable found
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

- [x] 6. Implement unified `start` CLI command (`src/cli/start.ts`)
  - [x] 6.1 Create `runStart(options)` function orchestrating the full startup sequence
    - Phase 1: Use `ChromeManager.connect()` to get browser instance, display spinner via `@clack/prompts`
    - Phase 2: Check for valid credentials in config; if missing or expired, navigate to `https://chat.ai.jh.edu`, call `captureCredentials` with 300s timeout, then minimize Chrome window
    - Phase 3: Initialize `PagePool`, create `CredentialHolder` + `ReauthLock`, start HTTP server via `startServer`
    - Phase 4: Start `TokenRefresher` background loop
    - Display base URL and API key on success
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.5, 4.6, 5.1, 5.2_
  - [x] 6.2 Register `start` command in `src/cli.ts`
    - Add `start` case to the switch statement with `--headless`, `--port`, `--pages` flag parsing
    - Update `printHelp()` to include the `start` command and its options
    - Wire shutdown handler to stop `TokenRefresher` and call `ChromeManager.shutdown()`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 7.1_

- [x] 7. Wire ReauthLock into server and chat completions route
  - [x] 7.1 Update `ServerDeps` in `src/server.ts` to accept optional `ReauthLock` and `CredentialHolder`
    - Add `reauthLock?: ReauthLock` and `setCredentials?: (creds: GatewayCredentials) => void` to `ServerDeps`
    - Pass through to `chatCompletionsRouter`
    - _Requirements: 6.1, 6.4_
  - [x] 7.2 Update `src/routes/chat-completions.ts` to use `ReauthLock` on 401 errors
    - When `sendChatRequest` throws a 401 error and `reauthLock` is available, call `reauthLock.acquire(recaptureFn)` to get fresh credentials
    - Retry the request exactly once with the new credentials
    - If re-capture fails, return 401 to client
    - Update `CredentialHolder` via `setCredentials` callback on successful re-capture
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x]* 7.3 Write property test for exactly-once 401 retry — Property 3
    - **Property 3: Exactly-once 401 retry per request**
    - **Validates: Requirements 6.2**
    - Mock `sendChatRequest` to fail with 401 on first call and succeed on second
    - Verify total attempts per request is at most 2

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Existing `setup`, `serve`, and `auth` commands are not modified — backward compatibility is preserved by design
