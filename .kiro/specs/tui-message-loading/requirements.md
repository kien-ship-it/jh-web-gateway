# Requirements Document

## Introduction

The TUI Server Activity Tracker feature adds real-time visibility into all HTTP requests hitting the jh-gateway server. Currently, the TUI has no live view of server activity — all API endpoints (models, health, chat completions from external clients) are invisible to the TUI user. This feature introduces a server-level request tracker embedded in the Info Panel (server info tab) that displays an animated loading indicator for in-flight requests, a live queue depth counter reflecting all queued server tasks, and per-request response timing. When a single incoming HTTP request triggers multiple queued sub-requests through the Request_Queue, those sub-requests are grouped under the parent request for clear visibility into internal processing. The tracker surfaces activity across every API endpoint, turning the gateway from a black box into a transparent, observable system directly within the server info tab. The Chat Panel is not modified by this feature.

## Glossary

- **TUI_App**: The top-level terminal user interface application that owns the screen and input loop.
- **Gateway_Server**: The local HTTP server (`src/server.ts`) running on the configured port, handling all OpenAI-compatible API requests across all routes (`/v1/chat/completions`, `/v1/models`, `/health`, etc.).
- **Request_Tracker**: A TUI component displayed in the Info_Panel that shows real-time server activity including in-flight requests, queue depth, parent/child request grouping, and per-request timing for all HTTP requests handled by the Gateway_Server. The Request_Tracker has a fixed height and scrolls internally when entries exceed the visible area.
- **Request_Queue**: The existing `RequestQueue` class (`src/core/request-queue.ts`) that serializes async tasks with a FIFO promise queue.
- **Active_Request**: An HTTP request currently being processed by the Gateway_Server (received but not yet responded to).
- **Request_Entry**: A single row in the Request_Tracker representing one HTTP request, showing its method, path, status, and elapsed time.
- **Parent_Request**: An incoming HTTP request to the Gateway_Server that triggers one or more Sub_Requests through the Request_Queue during its processing.
- **Sub_Request**: An internal task enqueued in the Request_Queue as a result of processing a Parent_Request. Sub_Requests are displayed as indented children under the Parent_Request in the Request_Tracker.
- **Loading_Indicator**: An animated visual element displayed in the Request_Tracker for each Active_Request to convey ongoing processing.
- **Queue_Depth_Display**: A UI element in the Request_Tracker that shows the current number of tasks waiting in the Request_Queue.
- **Response_Timer**: A per-request timer that tracks and displays the elapsed wall-clock time from request receipt to response completion.
- **App_Context**: The React context (`AppContext.tsx`) that holds shared TUI application state.
- **Elapsed_Time**: The wall-clock duration in milliseconds between when the Gateway_Server receives a request and when the response is fully sent.
- **Queue_Depth**: The number of tasks currently waiting in the Request_Queue (not including the actively executing task).
- **Info_Panel**: The existing TUI panel (`InfoPanel.tsx`) that displays server info including the base URL, API key, and gateway status.
- **Request_Log_Entry**: The existing `RequestLogEntry` type (`src/infra/types.ts`) that captures method, path, status code, latency, and token estimates for each request.

---

## Requirements

### Requirement 1: Server-Level Request Tracking

**User Story:** As a developer, I want to see all HTTP requests hitting my gateway server in real time, so that I have full visibility into server activity regardless of which API endpoint is being called.

#### Acceptance Criteria

1. WHEN the Gateway_Server receives an HTTP request on any route, THE Request_Tracker SHALL create a new Request_Entry for that request within 100ms of receipt.
2. THE Request_Entry SHALL display the HTTP method and path of the request (e.g., "POST /v1/chat/completions", "GET /v1/models", "GET /health").
3. WHILE an Active_Request is being processed, THE Request_Entry SHALL display a Loading_Indicator with an animated spinner to convey ongoing activity.
4. WHEN the Gateway_Server sends a response for a request, THE Request_Entry SHALL update to show the HTTP status code and final Elapsed_Time.
5. THE Request_Tracker SHALL display multiple concurrent Active_Requests simultaneously, each as a separate Request_Entry.
6. WHEN no requests are in flight and no recent requests exist, THE Request_Tracker SHALL display an idle state message such as "No recent activity".

---

### Requirement 2: Animated Loading Indicator for In-Flight Requests

**User Story:** As a developer, I want to see an animated indicator for each in-flight request, so that I can tell at a glance which requests are still being processed.

#### Acceptance Criteria

1. WHILE a request is an Active_Request, THE Loading_Indicator SHALL cycle through animation frames at a rate between 80ms and 200ms per frame.
2. WHILE a request is an Active_Request, THE Loading_Indicator SHALL display alongside the request method and path in the Request_Entry.
3. WHEN the Gateway_Server completes processing a request, THE Loading_Indicator SHALL stop the animation and be replaced by the response status code.
4. IF a request fails or times out, THEN THE Loading_Indicator SHALL stop the animation and be replaced by the error status code or a timeout indicator.

---

### Requirement 3: Queue Depth Display

**User Story:** As a developer, I want to see how many tasks are queued in the request queue, so that I understand how busy the gateway is and can anticipate wait times.

#### Acceptance Criteria

1. WHILE the Gateway_Server is running, THE Queue_Depth_Display SHALL show the current Queue_Depth value in the Request_Tracker.
2. WHEN the Queue_Depth is zero, THE Queue_Depth_Display SHALL display "Queue: idle" to indicate no tasks are waiting.
3. WHEN the Queue_Depth is one or more, THE Queue_Depth_Display SHALL display "Queue: N pending" where N is the current Queue_Depth value.
4. WHEN a new task is enqueued in the Request_Queue, THE Queue_Depth_Display SHALL update within 500ms to reflect the new Queue_Depth.
5. WHEN a task completes and is dequeued from the Request_Queue, THE Queue_Depth_Display SHALL update within 500ms to reflect the new Queue_Depth.
6. WHEN the Gateway_Server is not running, THE Queue_Depth_Display SHALL display "Queue: offline".

---

### Requirement 4: Per-Request Response Timing

**User Story:** As a developer, I want to see how long each request takes to complete, so that I can identify slow endpoints and gauge overall server performance.

#### Acceptance Criteria

1. WHEN the Gateway_Server receives an HTTP request, THE Response_Timer SHALL begin counting Elapsed_Time from the moment of receipt.
2. WHILE a request is an Active_Request, THE Response_Timer SHALL display a live elapsed time counter in the format "X.Xs" (e.g., "3.2s") updated at least once per second in the corresponding Request_Entry.
3. WHEN the Gateway_Server sends a response, THE Response_Timer SHALL stop counting and display the final Elapsed_Time in the Request_Entry in the format "X.Xs".
4. IF a request fails or times out, THEN THE Response_Timer SHALL stop counting and display the final Elapsed_Time in the Request_Entry.
5. THE Response_Timer SHALL measure wall-clock time with a resolution of 100ms or better.

---

### Requirement 5: Request Activity State Exposure from Server to TUI

**User Story:** As a developer building the TUI, I want the server request activity state to be accessible from the TUI layer, so that the Request_Tracker can display live server metrics.

#### Acceptance Criteria

1. THE Gateway_Server SHALL emit or expose request lifecycle events (request received, response sent) that include the HTTP method, path, status code, and Elapsed_Time.
2. THE Request_Queue SHALL expose a read-only `pending` property that returns the current number of waiting tasks (the existing `get pending()` accessor).
3. THE App_Context SHALL provide a mechanism for TUI components to read the list of Active_Requests and the current Queue_Depth from the running Gateway_Server.
4. WHEN the Gateway_Server is started via the TUI_App, THE App_Context SHALL store references to the request activity state and the active Request_Queue instance.
5. WHEN the Gateway_Server is stopped, THE App_Context SHALL clear the request activity state and Request_Queue reference, and THE Request_Tracker SHALL treat all values as empty or offline.

---

### Requirement 6: Request Tracker Placement in Info Panel

**User Story:** As a developer, I want the server activity tracker to be visible from the Info Panel, so that I can monitor server health alongside connection details.

#### Acceptance Criteria

1. THE Request_Tracker SHALL be displayed within the Info_Panel, positioned below the bordered box containing the Base URL and API Key and above the keyboard shortcuts section.
2. THE Request_Tracker SHALL occupy the full horizontal width of the Info_Panel.
3. WHILE the Gateway_Server is running, THE Request_Tracker SHALL be visible and actively updating.
4. WHEN the Gateway_Server is not running, THE Request_Tracker SHALL display an offline state and not show stale request data.
5. THE Request_Tracker SHALL have a fixed height that does not expand as new Request_Entries are added, to maintain a stable Info_Panel layout.
6. WHEN the number of Request_Entries exceeds the visible area of the fixed-height Request_Tracker, THE Request_Tracker SHALL provide vertical scrolling so the user can scroll through all entries.
7. THE Request_Tracker SHALL display a scrollable list of Request_Entries, showing the most recent requests at the top.
8. THE Request_Tracker SHALL retain up to 50 completed Request_Entries for review, removing the oldest entries when the limit is exceeded.
9. THE Info_Panel SHALL maintain the existing keyboard shortcuts: [c] Copy URL, [k] Copy Key, [b/Esc] Back.

---

### Requirement 7: Parent/Child Request Grouping

**User Story:** As a developer, I want to see which internal sub-requests were spawned by a single incoming HTTP request, so that I can understand what processing happens inside each API call.

#### Acceptance Criteria

1. WHEN an incoming HTTP request to the Gateway_Server triggers one or more tasks enqueued in the Request_Queue, THE Request_Tracker SHALL group those Sub_Requests under the originating Parent_Request.
2. THE Request_Tracker SHALL display Sub_Requests as indented children beneath the Parent_Request entry, visually distinguishing them from top-level requests.
3. WHILE any Sub_Request of a Parent_Request is an Active_Request, THE Parent_Request entry SHALL display a Loading_Indicator to indicate ongoing processing.
4. WHEN all Sub_Requests of a Parent_Request have completed, THE Parent_Request entry SHALL update its status to show the final HTTP status code and total Elapsed_Time.
5. THE Response_Timer on the Parent_Request SHALL measure the total wall-clock time from when the Parent_Request was received until all Sub_Requests have completed and the response is sent.
6. WHEN a Parent_Request has no Sub_Requests (e.g., a simple GET /health or GET /v1/models), THE Request_Tracker SHALL display the Parent_Request as a standalone Request_Entry with no grouping.
7. IF any Sub_Request fails, THEN THE Parent_Request entry SHALL reflect the error status once all Sub_Requests have resolved.
