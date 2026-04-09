# Requirements Document

## Introduction

The Enhanced TUI is a full-screen interactive terminal application for the `jh-gateway` CLI tool. It replaces the current linear command-line interface with a rich, keyboard-navigable experience. On first launch, users see an animated JHU logo splash screen. From there, a main menu lets users start the gateway, select AI models, send single-turn chat messages, and view server connection info — all without typing any commands. The TUI is designed to reduce friction: users navigate with arrow keys, trigger actions with Enter, and copy server details with a single keystroke.

## Glossary

- **TUI**: Terminal User Interface — the full-screen interactive application described in this document.
- **TUI_App**: The top-level TUI application process that owns the screen and input loop.
- **Splash_Screen**: The animated JHU logo display shown on first launch.
- **Main_Menu**: The arrow-key-navigable list of top-level actions.
- **Gateway_Panel**: The TUI panel that manages starting/stopping the gateway server and Chrome connection.
- **Model_Selector**: The TUI component for choosing an AI model from the available list.
- **Chat_Panel**: The single-turn chat interface embedded in the TUI.
- **Info_Panel**: The TUI panel displaying the server base URL and API key.
- **Gateway_Server**: The local HTTP server started by `runStart`, running on the configured port.
- **Chrome_Manager**: The existing `ChromeManager` class responsible for launching and connecting to Chrome via CDP.
- **Config**: The persisted `GatewayConfig` loaded from `~/.jh-gateway/config.json`.
- **API_Key**: The bearer token stored in `Config.auth.token`, used to authenticate requests to the Gateway_Server.
- **Available_Models**: The set of model IDs defined in `MODEL_ENDPOINT_MAP`: `claude-opus-4.5`, `claude-sonnet-4.5`, `claude-haiku-4.5`, `gpt-4.1`, `o3`, `o3-mini`, `gpt-5`, `llama3-3-70b-instruct`.

---

## Requirements

### Requirement 1: TUI Entry Point

**User Story:** As a developer, I want to launch the full-screen TUI with a single command, so that I can access all gateway features without memorizing subcommands.

#### Acceptance Criteria

1. WHEN the user runs `jh-gateway` with no arguments, THE TUI_App SHALL launch the full-screen TUI instead of printing help text. The `tui` subcommand SHALL also launch the TUI as an alias. All existing subcommands (`start`, `setup`, `serve`, `auth`, `config`, `status`, `logs`) SHALL continue to work as before.
2. WHEN the TUI_App is launched, THE TUI_App SHALL take exclusive control of the terminal screen using an alternate screen buffer.
3. WHEN the TUI_App exits, THE TUI_App SHALL restore the terminal to its original state, including cursor visibility and screen content.
4. IF the terminal does not support the minimum size of 80 columns by 24 rows, THEN THE TUI_App SHALL display a message instructing the user to resize the terminal and SHALL NOT render the full TUI until the terminal meets the minimum size.

---

### Requirement 2: JHU Logo Splash Screen

**User Story:** As a developer, I want to see an animated JHU logo when I first open the TUI, so that the tool feels polished and branded.

#### Acceptance Criteria

1. WHEN the TUI_App starts for the first time in a session, THE Splash_Screen SHALL render an ASCII-art JHU logo centered in the terminal.
2. WHEN the Splash_Screen is displayed, THE Splash_Screen SHALL animate the logo using a fade-in or sequential character reveal over a duration of 1500ms to 2500ms.
3. WHEN the Splash_Screen animation completes, THE Splash_Screen SHALL display a "Press any key to continue" prompt.
4. WHEN the user presses any key after the animation completes, THE TUI_App SHALL transition to the Main_Menu.
5. WHEN the user presses any key during the animation, THE Splash_Screen SHALL skip the remaining animation and immediately display the "Press any key to continue" prompt.

---

### Requirement 3: Main Menu Navigation

**User Story:** As a developer, I want to navigate the TUI using arrow keys, so that I can access all features without typing commands.

#### Acceptance Criteria

1. WHEN the Main_Menu is displayed, THE Main_Menu SHALL present the following options in order: "Start Gateway", "Model", "Chat", "Server Info", "Settings", "Quit".
2. WHEN the Main_Menu is displayed, THE Main_Menu SHALL highlight the currently focused menu item.
3. WHEN the user presses the Down Arrow key, THE Main_Menu SHALL move focus to the next menu item, wrapping from the last item to the first.
4. WHEN the user presses the Up Arrow key, THE Main_Menu SHALL move focus to the previous menu item, wrapping from the first item to the last.
5. WHEN the user presses Enter on a focused menu item, THE TUI_App SHALL navigate to the corresponding panel.
6. WHEN the user presses `q` or Escape from the Main_Menu, THE TUI_App SHALL display a confirmation prompt before exiting.
7. THE Main_Menu SHALL display a one-line description of the focused menu item as inline help text below the menu list.

---

### Requirement 4: Gateway Start Panel

**User Story:** As a developer, I want to start the gateway with a single keypress, so that I can connect Chrome and launch the server without running separate commands.

#### Acceptance Criteria

1. WHEN the user selects "Start Gateway" from the Main_Menu, THE Gateway_Panel SHALL display the current gateway status (running or stopped) and a "Start" or "Stop" button.
2. WHEN the user activates the "Start" button and the Gateway_Server is not running, THE Gateway_Panel SHALL invoke the same startup sequence as `runStart` (Chrome connection, authentication, server start).
3. WHEN the Gateway_Server startup sequence is in progress, THE Gateway_Panel SHALL display a live status indicator showing the current phase: "Connecting to Chrome", "Waiting for login", or "Starting server".
4. WHEN the Gateway_Server startup sequence completes successfully, THE Gateway_Panel SHALL display a success status and update the Info_Panel with the server URL and API_Key.
5. IF the Gateway_Server startup sequence fails, THEN THE Gateway_Panel SHALL display the error message and offer a "Retry" option.
6. WHEN the user activates the "Stop" button and the Gateway_Server is running, THE Gateway_Panel SHALL gracefully shut down the Gateway_Server and Chrome_Manager.
7. WHEN authentication is required during startup, THE Gateway_Panel SHALL display instructions telling the user to log in via the Chrome window that has been opened.
8. WHEN the user presses Escape or `b` from the Gateway_Panel, THE TUI_App SHALL return to the Main_Menu without stopping a running Gateway_Server.

---

### Requirement 5: Model Selector

**User Story:** As a developer, I want to select an AI model from a list, so that I can choose which model the chat interface uses without editing config files.

#### Acceptance Criteria

1. WHEN the user selects "Model" from the Main_Menu, THE Model_Selector SHALL display the list of Available_Models as a navigable list.
2. WHEN the Model_Selector is displayed, THE Model_Selector SHALL highlight the currently active model (loaded from Config.defaultModel).
3. WHEN the user presses Up or Down Arrow keys in the Model_Selector, THE Model_Selector SHALL move the highlight to the adjacent model.
4. WHEN the user presses Enter on a highlighted model, THE Model_Selector SHALL set that model as the active model for the current session and persist it to Config.defaultModel.
5. WHEN a model is selected, THE Model_Selector SHALL display a confirmation message showing the newly selected model name.
6. WHEN the user presses Escape or `b` from the Model_Selector, THE TUI_App SHALL return to the Main_Menu without changing the active model.

---

### Requirement 6: Single-Turn Chat Interface

**User Story:** As a developer, I want a chat interface in the TUI, so that I can send a test message to the running gateway and see the response without leaving the terminal.

#### Acceptance Criteria

1. WHEN the user selects "Chat" from the Main_Menu, THE Chat_Panel SHALL display an input field and a response area.
2. WHEN the Chat_Panel is displayed and the Gateway_Server is not running, THE Chat_Panel SHALL display an actionable prompt (e.g., "Gateway is not running. Press Enter to start it.") and SHALL either start the gateway inline when the user presses Enter, or navigate the user to the Gateway_Panel. The Chat_Panel SHALL NOT display a passive warning or leave the user without a clear next action.
3. WHEN the user types in the Chat_Panel input field and presses Enter, THE Chat_Panel SHALL send a single POST request to `http://127.0.0.1:{port}/v1/chat/completions` with the typed message as the user content, the active model, and the API_Key as the Authorization header.
4. WHEN a chat request is in flight, THE Chat_Panel SHALL display a loading indicator in the response area.
5. WHEN the Gateway_Server returns a response, THE Chat_Panel SHALL display the assistant message content in the response area.
6. IF the chat request fails or returns an error status, THEN THE Chat_Panel SHALL display the error message in the response area.
7. THE Chat_Panel SHALL NOT maintain conversation history between messages; each submission is an independent single-turn request.
8. WHEN a response is displayed, THE Chat_Panel SHALL clear the input field and allow the user to type a new message.
9. WHEN the user presses Escape or `b` from the Chat_Panel, THE TUI_App SHALL return to the Main_Menu.

---

### Requirement 7: Server Info Panel

**User Story:** As a developer, I want to see the server URL and API key in a dedicated panel, so that I can easily copy them for use in other tools.

#### Acceptance Criteria

1. WHEN the user selects "Server Info" from the Main_Menu, THE Info_Panel SHALL display the Gateway_Server base URL (e.g., `http://127.0.0.1:8741`) and the API_Key.
2. WHEN the Gateway_Server is not running, THE Info_Panel SHALL display the configured port and indicate that the server is not currently running.
3. WHEN the Info_Panel is displayed, THE Info_Panel SHALL show keyboard shortcut hints for copying the URL and API_Key (e.g., `[c] Copy URL`, `[k] Copy Key`).
4. WHEN the user presses `c` in the Info_Panel, THE Info_Panel SHALL copy the base URL to the system clipboard and display a brief "Copied!" confirmation.
5. WHEN the user presses `k` in the Info_Panel, THE Info_Panel SHALL copy the API_Key to the system clipboard and display a brief "Copied!" confirmation.
6. IF the system clipboard is unavailable, THEN THE Info_Panel SHALL display the URL and API_Key in a visually distinct box so the user can manually select and copy the text.
7. WHEN the user presses Escape or `b` from the Info_Panel, THE TUI_App SHALL return to the Main_Menu.

---

### Requirement 8: Inline Help and Guidelines

**User Story:** As a developer, I want contextual help text visible within the TUI, so that I understand available actions without consulting external documentation.

#### Acceptance Criteria

1. THE TUI_App SHALL display a persistent footer bar at the bottom of the screen showing the keyboard shortcuts relevant to the currently active panel.
2. WHEN the Main_Menu is active, THE TUI_App SHALL show shortcuts: `[↑↓] Navigate`, `[Enter] Select`, `[q] Quit`.
3. WHEN the Gateway_Panel is active, THE TUI_App SHALL show shortcuts: `[Enter] Start/Stop`, `[b] Back`, `[q] Quit`.
4. WHEN the Chat_Panel is active, THE TUI_App SHALL show shortcuts: `[Enter] Send`, `[b] Back`, `[q] Quit`.
5. WHEN the Info_Panel is active, THE TUI_App SHALL show shortcuts: `[c] Copy URL`, `[k] Copy Key`, `[b] Back`, `[q] Quit`.
6. THE TUI_App SHALL display a persistent header bar showing the application name "jh-gateway" and the current gateway status (running/stopped).

---

### Requirement 9: Settings Panel

**User Story:** As a developer, I want to view and edit key configuration values from within the TUI, so that I don't need to manually edit config files.

#### Acceptance Criteria

1. WHEN the user selects "Settings" from the Main_Menu, THE TUI_App SHALL display the current values of: port, cdpUrl, defaultModel, and auth mode.
2. WHEN the user selects a setting field and presses Enter, THE TUI_App SHALL allow inline editing of that field value.
3. WHEN the user confirms an edited value, THE TUI_App SHALL validate the value using the same rules as `validateConfig` and persist it via `updateConfig`.
4. IF a setting value fails validation, THEN THE TUI_App SHALL display the validation error message inline and SHALL NOT persist the invalid value.
5. WHEN the user presses Escape or `b` from the Settings panel, THE TUI_App SHALL return to the Main_Menu.

---

### Requirement 10: Graceful Exit

**User Story:** As a developer, I want the TUI to exit cleanly, so that my terminal is not left in a broken state.

#### Acceptance Criteria

1. WHEN the user presses `q` from any panel, THE TUI_App SHALL display a confirmation dialog: "Quit jh-gateway? Running gateway will be stopped. [y/N]".
2. WHEN the user confirms the quit dialog, THE TUI_App SHALL stop the Gateway_Server if running, shut down Chrome_Manager if it was launched by the TUI, restore the terminal, and exit with code 0.
3. WHEN the user cancels the quit dialog, THE TUI_App SHALL return to the previously active panel.
4. WHEN the TUI_App receives SIGINT or SIGTERM, THE TUI_App SHALL perform the same graceful shutdown as a confirmed quit without displaying the confirmation dialog.
5. IF the TUI_App encounters an unhandled error, THEN THE TUI_App SHALL restore the terminal before printing the error message and exiting with a non-zero exit code.
