# Implementation Plan: Enhanced TUI

## Overview

Build a full-screen interactive Terminal User Interface using Ink (React for terminals) that replaces the no-args help text with a panel-based navigation system. The TUI reuses the existing gateway lifecycle through an adapter layer, provides chat via the local HTTP endpoint, and clipboard via native OS commands. Implementation proceeds bottom-up: utilities and adapters first, then shared components, then panels, then wiring into the CLI entry point.

## Tasks

- [x] 1. Project setup and core types
  - [x] 1.1 Install Ink dependencies and configure TSX support
    - Run `npm install ink react` and `npm install -D @types/react`
    - Update `tsconfig.json` to add `"jsx": "react-jsx"` under `compilerOptions`
    - Verify build still works with `npm run build`
    - _Requirements: 1.1_

  - [x] 1.2 Create TUI type definitions (`src/tui/types.ts`)
    - Define `PanelId` union type: `"splash" | "menu" | "gateway" | "model" | "chat" | "info" | "settings"`
    - Define `TuiAppState` interface with fields: `currentPanel`, `gatewayStatus`, `gatewayError`, `activeModel`, `config`, `serverHandle`, `chromeState`, `tokenRefresher`
    - Define `MenuItem` interface with `id`, `label`, `description`
    - Define `MENU_ITEMS` constant array matching the design spec order
    - Define `GatewayPhase` interface with `label` and `status` fields
    - Export `FooterShortcut` type: `{ key: string; label: string }`
    - _Requirements: 3.1, 3.7_

- [x] 2. Utility modules
  - [x] 2.1 Implement clipboard utility (`src/tui/utils/clipboard.ts`)
    - Implement `copyToClipboard(text: string): Promise<boolean>` function
    - Detect platform via `process.platform`: use `pbcopy` on macOS, `xclip -selection clipboard` on Linux, `clip` on Windows
    - Spawn the appropriate command, write `text` to its stdin, return `true` on success
    - Return `false` if the command fails or is unavailable (catch spawn errors)
    - _Requirements: 7.4, 7.5, 7.6_

  - [x]* 2.2 Write property test for clipboard utility
    - **Property 6: Server info display accuracy** (partial — clipboard is a dependency of info display)
    - **Validates: Requirements 7.4, 7.5**

  - [ ] 2.3 Implement navigation helpers (`src/tui/utils/navigation.ts`)
    - Implement `wrapIndex(current: number, delta: number, listSize: number): number` that computes `((current + delta) % listSize + listSize) % listSize`
    - Export the function for use by MainMenu and ModelSelector
    - _Requirements: 3.3, 3.4, 5.3_

  - [x]* 2.4 Write property test for wrapping navigation
    - **Property 1: Wrapping list navigation**
    - Use `fc.integer({min:2, max:20})` for list size, `fc.nat()` for start index and press count
    - Verify Down: `wrapIndex(i, d, N) === (i + d) % N`
    - Verify Up: `wrapIndex(i, -u, N) === ((i - u % N) + N) % N`
    - **Validates: Requirements 3.3, 3.4, 5.3**

  - [x] 2.5 Implement footer shortcut map (`src/tui/utils/shortcuts.ts`)
    - Define a `PANEL_SHORTCUTS: Record<PanelId, FooterShortcut[]>` mapping each panel to its exact set of keyboard shortcuts per Requirement 8
    - Menu: `[↑↓] Navigate`, `[Enter] Select`, `[q] Quit`
    - Gateway: `[Enter] Start/Stop`, `[b] Back`, `[q] Quit`
    - Chat: `[Enter] Send`, `[b] Back`, `[q] Quit`
    - Info: `[c] Copy URL`, `[k] Copy Key`, `[b] Back`, `[q] Quit`
    - Settings: `[Enter] Edit`, `[b] Back`, `[q] Quit`
    - Splash: `[any] Continue`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x]* 2.6 Write property test for footer shortcuts
    - **Property 7: Context-sensitive footer shortcuts**
    - Generate random panel ID via `fc.constantFrom("menu","gateway","chat","info","settings")`
    - Verify `PANEL_SHORTCUTS[panelId]` returns exactly the expected shortcut set and no shortcuts from other panels
    - **Validates: Requirements 8.1**

- [ ] 3. Checkpoint — Verify utilities
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Gateway lifecycle adapter
  - [ ] 4.1 Implement gateway lifecycle adapter (`src/tui/services/gateway-lifecycle.ts`)
    - Define `GatewayLifecycleCallbacks` interface with `onPhase`, `onSuccess`, `onError`
    - Implement `startGatewayForTui(config, options, callbacks)` that mirrors `runStart` logic:
      - Phase 1: Create `ChromeManager`, call `connect()`, invoke `callbacks.onPhase("Connecting to Chrome")`
      - Phase 2: Check credentials, call `captureCredentials` if needed, invoke `callbacks.onPhase("Waiting for login")`
      - Phase 3: Create `PagePool`, `CredentialHolder`, call `startServer`, invoke `callbacks.onPhase("Starting server")`
      - On success: invoke `callbacks.onSuccess({ baseUrl, apiKey })`, return `{ serverHandle, chromeState, tokenRefresher }`
      - On error: invoke `callbacks.onError(error)`, rethrow
    - Implement `stopGateway(serverHandle, chromeState, tokenRefresher)` that stops the token refresher, closes the server, and shuts down Chrome
    - Do NOT register SIGINT/SIGTERM handlers (the TUI root handles those)
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6_

  - [ ]* 4.2 Write unit tests for gateway lifecycle adapter
    - Mock `ChromeManager`, `captureCredentials`, `PagePool`, `startServer`, `TokenRefresher`
    - Verify `onPhase` is called with correct phase labels in sequence
    - Verify `onSuccess` is called with correct baseUrl and apiKey on success
    - Verify `onError` is called on failure
    - Verify `stopGateway` calls shutdown methods in correct order
    - _Requirements: 4.2, 4.3, 4.5, 4.6_

- [ ] 5. Shared UI components
  - [ ] 5.1 Implement HeaderBar component (`src/tui/components/HeaderBar.tsx`)
    - Accept `gatewayStatus` prop: `"stopped" | "starting" | "running" | "error"`
    - Render single line: left-aligned "jh-gateway", right-aligned status with colored indicator
    - Green dot for running, red for stopped/error, yellow for starting
    - Use Ink's `<Box>` with `justifyContent="space-between"` and `<Text>` with color props
    - _Requirements: 8.6_

  - [ ] 5.2 Implement FooterBar component (`src/tui/components/FooterBar.tsx`)
    - Accept `shortcuts: FooterShortcut[]` prop
    - Render single line with shortcuts formatted as `[key] label` separated by spaces
    - Use Ink's `<Box>` and `<Text>` with dim styling for brackets
    - _Requirements: 8.1_

  - [ ] 5.3 Implement AppContext and state management (`src/tui/AppContext.tsx`)
    - Create React context `AppContext` holding `TuiAppState` and dispatch functions
    - Implement `AppProvider` component that:
      - Loads config via `loadConfig()` on mount
      - Provides `navigate(panelId)`, `setGatewayStatus(status)`, `setGatewayError(error)`, `setActiveModel(model)`, `setServerHandle(handle)`, `setChromeState(state)`, `setTokenRefresher(refresher)` functions
    - Export `useAppContext()` hook
    - _Requirements: 3.5, 4.4, 5.4_

- [ ] 6. Panel components — Part 1
  - [ ] 6.1 Implement SplashScreen panel (`src/tui/panels/SplashScreen.tsx`)
    - Accept `onComplete: () => void` prop
    - Define ASCII-art JHU logo as a string constant
    - Use `useEffect` + `setInterval` to reveal characters sequentially over 1500–2500ms
    - Track `revealedCount` and `animationComplete` state
    - Use Ink's `useInput` hook: any keypress during animation sets `animationComplete = true` and clears interval
    - After animation complete, show "Press any key to continue" text
    - Any keypress after animation calls `onComplete`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 6.2 Implement MainMenu panel (`src/tui/panels/MainMenu.tsx`)
    - Render `MENU_ITEMS` as a vertical list using Ink `<Box flexDirection="column">`
    - Track `focusedIndex` state, initialized to 0
    - Use `useInput` hook for arrow keys: Down calls `wrapIndex(focusedIndex, 1, MENU_ITEMS.length)`, Up calls `wrapIndex(focusedIndex, -1, MENU_ITEMS.length)`
    - Highlight focused item with a `>` prefix and bold/color styling
    - Display `MENU_ITEMS[focusedIndex].description` below the list as inline help
    - Enter on focused item: if `id === "quit"`, trigger quit confirmation; otherwise call `navigate(id)`
    - `q` or Escape triggers quit confirmation dialog
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 6.3 Write property test for menu description match
    - **Property 2: Focused item description matches menu data**
    - Generate random index `fc.integer({min:0, max:5})`
    - Verify the description displayed for index `i` equals `MENU_ITEMS[i].description`
    - **Validates: Requirements 3.7**

  - [ ] 6.4 Implement ModelSelector panel (`src/tui/panels/ModelSelector.tsx`)
    - Accept `models`, `activeModel`, `onSelect`, `onBack` props
    - Render model list with `●` marker for active model, `○` for others
    - Track `focusedIndex` state; use `wrapIndex` for Up/Down navigation
    - Enter persists selection: call `onSelect(selectedModel)` which updates context and calls `updateConfig({ defaultModel: selected })`
    - Show brief confirmation toast (1.5s timeout) on selection
    - Escape or `b` calls `onBack`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 6.5 Write property test for model selection persistence
    - **Property 3: Model selection persistence and confirmation**
    - Generate random model via `fc.constantFrom(...Object.keys(MODEL_ENDPOINT_MAP))`
    - Mock `updateConfig`, simulate selection, verify `updateConfig` called with `{ defaultModel: model }` and confirmation message contains model name
    - **Validates: Requirements 5.4, 5.5**

- [ ] 7. Checkpoint — Verify shared components and Part 1 panels
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Panel components — Part 2
  - [ ] 8.1 Implement GatewayPanel (`src/tui/panels/GatewayPanel.tsx`)
    - Read `gatewayStatus`, `serverHandle`, `chromeState`, `tokenRefresher` from `useAppContext()`
    - Display current status and Start/Stop button
    - On Start: call `startGatewayForTui(config, { headless: false }, callbacks)` where callbacks update gateway phases in local state
    - Show phase indicators: "Connecting to Chrome" → "Waiting for login" → "Starting server" with pending/active/done/error status
    - On success: update app context with `serverHandle`, `chromeState`, `tokenRefresher`, set `gatewayStatus` to `"running"`
    - On error: display error message with "Retry" option, set `gatewayStatus` to `"error"`
    - On Stop: call `stopGateway(...)`, clear context handles, set `gatewayStatus` to `"stopped"`
    - When auth required, display "Please log in via the Chrome window"
    - Escape or `b` navigates back to menu without stopping gateway
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [ ] 8.2 Implement ChatPanel (`src/tui/panels/ChatPanel.tsx`)
    - Read `gatewayStatus`, `config` from `useAppContext()`
    - When gateway not running: show "Gateway is not running. Press Enter to start it." — Enter navigates to GatewayPanel
    - When gateway running: render text input field (Ink `<TextInput>`) at bottom, response area above
    - On Enter with non-empty input: POST to `http://127.0.0.1:{port}/v1/chat/completions` with `{ model: activeModel, messages: [{ role: "user", content: input }] }` and `Authorization: Bearer {apiKey}` header
    - Show spinner during request (use Ink `<Spinner>`)
    - Display assistant response content in response area on success
    - Display error message on failure (connection error, non-200 status, timeout)
    - Clear input field after response; each submission is independent (no history)
    - Escape or `b` navigates back to menu
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [ ]* 8.3 Write property test for stateless chat request construction
    - **Property 4: Stateless chat request construction**
    - Generate random non-empty message via `fc.string({minLength:1})` and random model via `fc.constantFrom(...Object.keys(MODEL_ENDPOINT_MAP))`
    - Extract the request body that would be sent, verify `messages` has exactly one entry `{ role: "user", content: msg }`, `model` equals the selected model, and no prior messages are included
    - **Validates: Requirements 6.3, 6.7**

  - [ ]* 8.4 Write property test for chat response content extraction
    - **Property 5: Chat response content extraction**
    - Generate random content string via `fc.string()`
    - Wrap in OpenAI response format: `{ choices: [{ message: { role: "assistant", content: c } }] }`
    - Verify the extraction logic returns text that includes `c`
    - **Validates: Requirements 6.5**

  - [ ] 8.5 Implement InfoPanel (`src/tui/panels/InfoPanel.tsx`)
    - Accept `port`, `apiKey`, `gatewayRunning`, `onBack` from context/props
    - Display base URL as `http://127.0.0.1:{port}` and API key in a bordered box (Ink `<Box borderStyle="round">`)
    - When gateway not running, show "not running" indicator
    - Show shortcut hints: `[c] Copy URL`, `[k] Copy Key`
    - `c` keypress: call `copyToClipboard(baseUrl)`, show "Copied!" flash for 1.5s; on failure show "Clipboard unavailable" and display text in bordered box
    - `k` keypress: call `copyToClipboard(apiKey)`, same flash/fallback behavior
    - Escape or `b` navigates back to menu
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 8.6 Write property test for server info display accuracy
    - **Property 6: Server info display accuracy**
    - Generate random valid port via `fc.integer({min:1, max:65535})` and optional API key via `fc.option(fc.string({minLength:1}))`
    - Verify displayed URL equals `http://127.0.0.1:{port}` and API key display matches (or shows "no auth" when null)
    - **Validates: Requirements 7.1**

  - [ ] 8.7 Implement SettingsPanel (`src/tui/panels/SettingsPanel.tsx`)
    - Read config from `useAppContext()`
    - Display editable fields: `port`, `cdpUrl`, `defaultModel`, `auth.mode`
    - Track `focusedField` and `editingField` state
    - Arrow keys navigate fields; Enter toggles edit mode
    - In edit mode: render inline text input; Enter confirms, Escape cancels
    - On confirm: validate value using `validateConfig` rules; if valid, call `updateConfig()` and update displayed value; if invalid, show inline error and don't persist
    - Escape or `b` (when not editing) navigates back to menu
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 8.8 Write property test for settings display accuracy
    - **Property 8: Settings display accuracy**
    - Generate random valid `GatewayConfig` via `fc.record(...)` matching the config shape
    - Verify all four displayed fields (`port`, `cdpUrl`, `defaultModel`, `auth.mode`) equal the corresponding config values
    - **Validates: Requirements 9.1**

  - [ ]* 8.9 Write property test for settings validation round-trip
    - **Property 9: Settings validation round-trip**
    - Generate both valid and invalid values for each config field using `fc.oneof(validGen, invalidGen)`
    - Verify: valid values result in `updateConfig` being called and displayed value updating; invalid values leave config unchanged and produce an error message
    - **Validates: Requirements 9.3, 9.4**

- [ ] 9. Checkpoint — Verify all panels
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. App shell, router, and quit dialog
  - [ ] 10.1 Implement quit confirmation dialog (`src/tui/components/QuitDialog.tsx`)
    - Render overlay: "Quit jh-gateway? Running gateway will be stopped. [y/N]"
    - `y` confirms: call `stopGateway` if running, then exit
    - `N` or Escape cancels: return to previous panel
    - Track `previousPanel` so cancel restores correct panel
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 10.2 Write property test for quit dialog panel preservation
    - **Property 10: Quit dialog panel preservation**
    - Generate random panel ID via `fc.constantFrom("menu","gateway","chat","info","settings")`
    - Simulate triggering quit dialog then canceling; verify TUI returns to the same panel with state unchanged
    - **Validates: Requirements 10.1, 10.3**

  - [ ] 10.3 Implement App root with router (`src/tui/App.tsx`)
    - Wrap everything in `<AppProvider>`
    - Render `<HeaderBar>` at top, active panel in middle (flex-grow), `<FooterBar>` at bottom
    - Implement panel router: switch on `currentPanel` to render the correct panel component
    - Pass `PANEL_SHORTCUTS[currentPanel]` to `<FooterBar>`
    - Handle global `q` keypress to show `<QuitDialog>` overlay from any panel
    - _Requirements: 1.2, 8.1, 8.6_

  - [ ] 10.4 Implement TUI entry point (`src/tui/index.ts`)
    - Implement `launchTui()` async function
    - Check terminal size: if below 80×24, display resize message and wait
    - Call Ink's `render(<App />, { exitOnCtrlC: false })` to use alternate screen buffer
    - Register SIGINT/SIGTERM handlers for graceful shutdown: stop gateway if running, restore terminal, exit 0
    - Handle unhandled errors: restore terminal, print to stderr, exit 1
    - _Requirements: 1.2, 1.3, 1.4, 10.4, 10.5_

  - [ ] 10.5 Modify CLI entry point (`src/cli.ts`)
    - Change the no-argument case: instead of `printHelp()`, dynamically import `./tui/index.js` and call `launchTui()`
    - Add `"tui"` as a recognized command that also calls `launchTui()`
    - Keep `--help` / `-h` behavior: print help and exit
    - All existing subcommands remain unchanged
    - _Requirements: 1.1_

  - [ ]* 10.6 Write unit tests for CLI routing changes
    - Verify no-args calls `launchTui`
    - Verify `tui` command calls `launchTui`
    - Verify `start` still calls `runStart`
    - Verify `--help` prints help
    - Verify unknown command prints error
    - _Requirements: 1.1_

- [ ] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 10 universal correctness properties defined in the design document
- Unit tests validate specific examples and edge cases
- The TUI uses TypeScript with JSX (`react-jsx`) for all Ink components
- All new files go under `src/tui/` except the CLI entry point modification
