# Implementation Plan: TUI Message Loading (Request Tracker)

## Overview

Implement a real-time server activity tracker displayed in the Info Panel. The implementation proceeds bottom-up: core tracker class → server middleware → AppContext wiring → React components → integration. Each step builds on the previous one so there is no orphaned code.

## Tasks

- [x] 1. Implement RequestActivityTracker core class
  - [x] 1.1 Create `src/core/request-activity-tracker.ts` with types and class
    - Define `RequestStatus`, `RequestEntry`, `TrackerListener` types
    - Implement `RequestActivityTracker` class with `entries` Map, `orderedIds` array, `listeners` Set, and `maxCompleted` (default 50)
    - Implement `start(id, method, path)` — creates active entry, pushes to front of `orderedIds`, calls `notify()`
    - Implement `end(id, statusCode)` — sets terminal status (`"completed"` for 2xx, `"error"` otherwise), computes `elapsedMs`, prunes completed entries beyond `maxCompleted`, calls `notify()`
    - Implement `addChild(parentId, childId, label)` — creates child entry linked via `parentId`, appends to parent's `children` array, calls `notify()`
    - Implement `endChild(childId, statusCode)` — completes child, derives parent status when all children done, calls `notify()`
    - Implement `subscribe(listener)` returning unsubscribe function, `getEntries()`, `getChildren(parentId)`, `getEntry(id)`, `clear()`
    - Handle edge cases: duplicate `start(id)` ignored, `end(id)` for unknown ID is no-op, subscriber errors caught and logged
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 4.1, 4.5, 5.1, 6.7, 6.8, 7.1, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 1.2 Write property test: Entry creation preserves request data (Property 1)
    - **Property 1: Entry creation preserves request data**
    - **Validates: Requirements 1.1, 1.2, 4.1**

  - [ ]* 1.3 Write property test: Entry completion stores status and elapsed time (Property 2)
    - **Property 2: Entry completion stores status and elapsed time**
    - **Validates: Requirements 1.4, 2.3, 2.4**

  - [ ]* 1.4 Write property test: Concurrent active requests are independent (Property 3)
    - **Property 3: Concurrent active requests are independent**
    - **Validates: Requirements 1.5**

  - [ ]* 1.5 Write property test: Entries ordered most-recent-first (Property 7)
    - **Property 7: Entries ordered most-recent-first**
    - **Validates: Requirements 6.7**

  - [ ]* 1.6 Write property test: Bounded retention of completed entries (Property 8)
    - **Property 8: Bounded retention of completed entries**
    - **Validates: Requirements 6.8**

  - [ ]* 1.7 Write property test: Sub-request grouping (Property 9)
    - **Property 9: Sub-request grouping**
    - **Validates: Requirements 7.1**

  - [ ]* 1.8 Write property test: Parent status derived from children (Property 10)
    - **Property 10: Parent status derived from children**
    - **Validates: Requirements 7.3, 7.4, 7.5, 7.7**

- [x] 2. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Add formatting utilities and their tests
  - [x] 3.1 Create `formatElapsed(ms)` and `formatQueueDepth(n, online)` helper functions
    - `formatElapsed`: converts milliseconds to `"X.Xs"` format (e.g., 3200 → `"3.2s"`)
    - `formatQueueDepth`: returns `"Queue: idle"` for 0, `"Queue: N pending"` for N≥1, `"Queue: offline"` when not online
    - Place in `src/core/request-activity-tracker.ts` or a separate `src/tui/utils/format.ts` file
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 4.2, 4.3_

  - [ ]* 3.2 Write property test: Elapsed time formatting (Property 4)
    - **Property 4: Elapsed time formatting**
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 3.3 Write property test: Queue depth formatting (Property 5)
    - **Property 5: Queue depth formatting**
    - **Validates: Requirements 3.1, 3.3**

- [x] 4. Add Hono middleware for request tracking
  - [x] 4.1 Implement `requestTrackerMiddleware` in `src/server.ts`
    - Create middleware function that takes a `RequestActivityTracker` instance
    - Generate a UUID per request, store as `c.set("requestId", id)`
    - Call `tracker.start(id, method, path)` on entry
    - Call `tracker.end(id, statusCode)` after `await next()` (in try/catch, recording 500 on error)
    - Mount the middleware before all routes in `createServer()`
    - Update `createServer()` signature to accept an optional `RequestActivityTracker` in `ServerDeps`
    - _Requirements: 1.1, 5.1_

  - [ ]* 4.2 Write property test: Lifecycle events contain required fields (Property 6)
    - **Property 6: Lifecycle events contain required fields**
    - **Validates: Requirements 5.1**

- [x] 5. Integrate tracker with chat completions route
  - [x] 5.1 Update `chatCompletionsRouter` to call `addChild`/`endChild` on the tracker
    - Pass the tracker through `ChatCompletionsDeps`
    - Read `parentId` from `c.get("requestId")`
    - Before `queue.enqueue()`, call `tracker.addChild(parentId, childId, "queue: sendChatRequest")`
    - On success, call `tracker.endChild(childId, 200)`; on error, call `tracker.endChild(childId, statusCode)`
    - Apply the same pattern to the 401-retry path
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Wire tracker through AppContext and gateway lifecycle
  - [x] 7.1 Add `requestTracker` and `requestQueue` fields to `TuiAppState` and `AppContext`
    - Add `requestTracker: RequestActivityTracker | null` and `requestQueue: RequestQueue | null` to `TuiAppState` in `src/tui/types.ts`
    - Add `setRequestTracker` and `setRequestQueue` setters to `AppContextValue` in `src/tui/AppContext.tsx`
    - Initialize both to `null` in `initialState`
    - _Requirements: 5.3, 5.4_

  - [x] 7.2 Update `gateway-lifecycle.ts` to create and wire the tracker
    - Create a `RequestActivityTracker` instance in `startGatewayForTui` before calling `startServer`
    - Pass the tracker to `createServer()` via `ServerDeps`
    - Return the tracker and the `RequestQueue` (from the `PagePool`) in `StartGatewayResult`
    - In `GatewayPanel`, call `setRequestTracker(result.tracker)` and `setRequestQueue(result.queue)` on start
    - On `stopGateway`, call `tracker.clear()`, then `setRequestTracker(null)` and `setRequestQueue(null)`
    - _Requirements: 5.4, 5.5_

- [x] 8. Implement RequestTracker React/Ink component
  - [x] 8.1 Create `src/tui/components/RequestTracker.tsx`
    - Read `requestTracker`, `requestQueue`, and `gatewayStatus` from `useAppContext()`
    - Subscribe to tracker via `useEffect` + `tracker.subscribe()`, store entries in local state
    - Render section header "Server Activity" (bold)
    - Render queue depth line using `formatQueueDepth(queue?.pending ?? 0, gatewayStatus === "running")`
    - Render fixed-height scrollable container (`height={8}`, `overflowY="hidden"`) with request entries
    - Implement scroll offset via `useState`, controlled by `j`/`k` or `↑`/`↓` keys
    - Show "No recent activity" when entries are empty and gateway is running
    - Show offline state when gateway is not running
    - _Requirements: 1.6, 3.1, 3.2, 3.3, 3.6, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 8.2 Implement RequestEntry sub-component rendering
    - Active entries: spinner frame + method + path + live elapsed time
    - Completed entries: status code (green for 2xx, red for 4xx/5xx) + method + path + final elapsed
    - Children: indented with `├─` prefix under parent
    - Spinner uses `SPINNER_FRAMES` array, frame index derived from `Math.floor(Date.now() / 100) % SPINNER_FRAMES.length`
    - Live elapsed timer via `useEffect` with 200ms `setInterval` while any entry is active
    - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 4.2, 4.3, 4.4, 7.2, 7.6_

  - [ ]* 8.3 Write unit tests for RequestTracker component
    - Test idle state message when tracker is empty (Req 1.6)
    - Test offline state when gateway not running (Req 3.6, 6.4)
    - Test spinner frame array has correct length and characters
    - Test standalone entry renders without grouping (Req 7.6)
    - _Requirements: 1.6, 3.6, 6.4, 7.6_

- [x] 9. Integrate RequestTracker into InfoPanel
  - [x] 9.1 Render `<RequestTracker />` in `InfoPanel` below the connection info box
    - Import and render `RequestTracker` between the bordered URL/API key box and the keyboard shortcuts section
    - Ensure `RequestTracker` occupies full horizontal width
    - Verify existing keyboard shortcuts `[c]` Copy URL, `[k]` Copy Key, `[b/Esc]` Back still work
    - _Requirements: 6.1, 6.2, 6.9_

  - [ ]* 9.2 Write unit tests for InfoPanel integration
    - Test that `RequestTracker` is rendered within `InfoPanel`
    - Test that existing keyboard shortcuts are preserved
    - _Requirements: 6.1, 6.9_

- [x] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (Properties 1–10)
- Unit tests validate specific examples and edge cases
- The project uses TypeScript, React/Ink for TUI, Hono for HTTP, vitest for testing, and fast-check for property-based tests
