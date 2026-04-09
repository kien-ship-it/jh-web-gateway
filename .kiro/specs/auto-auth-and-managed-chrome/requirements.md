# Requirements Document

## Introduction

The JH Web Gateway currently requires users to manually launch Chrome with remote debugging, open multiple terminals, and re-authenticate when tokens expire. This feature consolidates the entire workflow into a single CLI command that manages Chrome lifecycle, automates authentication, proactively refreshes tokens, and provides a seamless single-TUI experience where the user logs in once and everything else is handled automatically.

## Glossary

- **Gateway**: The jh-web-gateway local HTTP server that proxies OpenAI-compatible API requests through the JH web platform session.
- **Chrome_Manager**: The subsystem responsible for launching, connecting to, and managing the lifecycle of a Chrome browser process with remote debugging enabled.
- **Token_Refresher**: The subsystem responsible for monitoring JWT token expiry and proactively re-capturing credentials before they expire.
- **Auth_Capture**: The existing credential capture mechanism that intercepts outgoing requests to chat.ai.jh.edu and extracts Bearer tokens, cookies, and user agent strings.
- **CDP**: Chrome DevTools Protocol, used to connect to and control Chrome programmatically.
- **Unified_CLI**: The single CLI command (`jh-gateway start`) that orchestrates Chrome launch, authentication, and server startup in one terminal.
- **Config_Store**: The configuration file at `~/.jh-gateway/config.json` that persists gateway settings and credentials.

## Requirements

### Requirement 1: Managed Chrome Lifecycle

**User Story:** As a gateway user, I want the gateway to launch and manage Chrome automatically, so that I do not need to manually start Chrome with debugging flags in a separate terminal.

#### Acceptance Criteria

1. WHEN the Unified_CLI command is executed and no Chrome instance with remote debugging is detected, THE Chrome_Manager SHALL launch a new Chrome process with the `--remote-debugging-port` flag and a dedicated user data directory at `~/.jh-gateway/chrome-profile`.
2. WHEN the Unified_CLI command is executed and an existing Chrome instance with remote debugging is already running, THE Chrome_Manager SHALL connect to the existing Chrome instance instead of launching a new one.
3. WHEN Chrome is launched by the Chrome_Manager, THE Chrome_Manager SHALL detect the Chrome executable path for the current operating system (macOS, Linux, Windows).
4. WHEN the Gateway shuts down via SIGINT or SIGTERM, THE Chrome_Manager SHALL terminate the managed Chrome process if the Chrome_Manager launched the Chrome process.
5. WHEN the Gateway shuts down and Chrome was not launched by the Chrome_Manager, THE Chrome_Manager SHALL leave the externally managed Chrome process running.
6. IF the Chrome_Manager fails to launch Chrome because no Chrome executable is found, THEN THE Chrome_Manager SHALL display a descriptive error message indicating Chrome is not installed or not found at expected paths.
7. IF the managed Chrome process crashes or disconnects during operation, THEN THE Chrome_Manager SHALL attempt to relaunch Chrome and reconnect within 30 seconds.

### Requirement 2: Automated Initial Authentication

**User Story:** As a gateway user, I want the gateway to automatically open the JH login page so I only need to sign in once, so that I do not need to manually navigate to the login page or run separate auth commands.

#### Acceptance Criteria

1. WHEN Chrome is connected and no valid credentials exist in the Config_Store, THE Gateway SHALL navigate to `https://chat.ai.jh.edu` and wait for the user to complete login.
2. WHEN the user completes login and the Auth_Capture intercepts a valid Bearer token, THE Gateway SHALL persist the captured credentials to the Config_Store and proceed to start the HTTP server.
3. WHEN Chrome is connected and valid (non-expired) credentials already exist in the Config_Store, THE Gateway SHALL skip the login step and proceed directly to start the HTTP server.
4. IF the user does not complete login within 300 seconds, THEN THE Gateway SHALL display a timeout message and exit with a non-zero status code.

### Requirement 3: Proactive Token Refresh

**User Story:** As a gateway user, I want tokens to refresh automatically before they expire, so that I never encounter authentication failures during active use.

#### Acceptance Criteria

1. WHILE the Gateway is running, THE Token_Refresher SHALL check the JWT `exp` claim of the current Bearer token at a regular interval of 60 seconds.
2. WHEN the current Bearer token is within 5 minutes of expiry, THE Token_Refresher SHALL trigger a credential re-capture by reloading the JH page and intercepting a fresh Bearer token.
3. WHEN the Token_Refresher successfully captures a fresh Bearer token, THE Token_Refresher SHALL update the in-memory credentials and persist the new credentials to the Config_Store.
4. WHEN the Token_Refresher successfully refreshes credentials, THE Token_Refresher SHALL log a message indicating the refresh succeeded and the new token expiry time.
5. IF the Token_Refresher fails to capture a fresh Bearer token after 3 consecutive attempts, THEN THE Token_Refresher SHALL log a warning message and continue operating with the current credentials.
6. WHILE a token refresh is in progress, THE Token_Refresher SHALL allow in-flight API requests to continue using the current credentials without interruption.

### Requirement 4: Unified Single-Command Startup

**User Story:** As a gateway user, I want a single command that handles Chrome launch, authentication, and server startup, so that I can operate the entire gateway from one terminal.

#### Acceptance Criteria

1. THE Unified_CLI SHALL be invoked as `jh-gateway start` and SHALL execute the following sequence: Chrome connection or launch, authentication, and HTTP server startup.
2. WHEN the `--headless` flag is passed to the Unified_CLI, THE Chrome_Manager SHALL launch Chrome in headless mode.
3. WHEN the `--port` flag is passed to the Unified_CLI, THE Gateway SHALL use the specified port for the HTTP server.
4. WHEN the `--pages` flag is passed to the Unified_CLI, THE Gateway SHALL configure the page pool with the specified maximum number of concurrent pages.
5. THE Unified_CLI SHALL display a progress indicator for each phase of startup: Chrome connection, authentication status, and server readiness.
6. WHEN all startup phases complete successfully, THE Unified_CLI SHALL display the base URL and API key required to connect to the Gateway.

### Requirement 5: Post-Login Chrome Window Management

**User Story:** As a gateway user, I want Chrome to be minimized or hidden after I sign in, so that the browser window does not clutter my workspace during normal operation.

#### Acceptance Criteria

1. WHEN the Auth_Capture successfully captures credentials after user login, THE Chrome_Manager SHALL minimize the Chrome browser window.
2. WHEN the `--headless` flag is used, THE Chrome_Manager SHALL launch Chrome without any visible window.
3. WHEN the Token_Refresher needs to perform a credential refresh, THE Chrome_Manager SHALL perform the refresh without bringing the Chrome window to the foreground.

### Requirement 6: Resilient Request Authentication

**User Story:** As a gateway user, I want API requests to automatically recover from authentication failures, so that transient token issues do not cause request failures.

#### Acceptance Criteria

1. WHEN an API request receives a 401 response from the JH platform, THE Gateway SHALL trigger an immediate credential re-capture and retry the failed request with the new credentials.
2. WHEN an API request receives a 401 response and the credential re-capture succeeds, THE Gateway SHALL retry the original request exactly once with the refreshed credentials.
3. IF an API request receives a 401 response and the credential re-capture fails, THEN THE Gateway SHALL return a 401 error to the client with a message indicating re-authentication failed.
4. WHILE a credential re-capture triggered by a 401 response is in progress, THE Gateway SHALL queue subsequent requests that encounter 401 errors and retry them after the re-capture completes, rather than triggering multiple concurrent re-captures.

### Requirement 7: Backward Compatibility

**User Story:** As an existing gateway user, I want the existing `setup`, `serve`, and `auth` commands to continue working, so that my current workflow is not broken.

#### Acceptance Criteria

1. THE Gateway SHALL retain the existing `jh-gateway setup`, `jh-gateway serve`, and `jh-gateway auth` commands with their current behavior.
2. THE Config_Store SHALL remain backward compatible with existing `~/.jh-gateway/config.json` files that do not contain new configuration fields.
3. WHEN new configuration fields are absent from an existing config file, THE Gateway SHALL use default values for the new fields.
