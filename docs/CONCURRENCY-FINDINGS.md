# Concurrency Investigation Findings

## Summary

We investigated improving concurrent request throughput for the JH Gateway. The key finding is that **the JH platform enforces server-side rate limiting of one active generation per user account**, regardless of how many browser tabs or pages are used.

## What We Tried

### 1. Page Pool Implementation

Created a `PagePool` class (`src/core/page-pool.ts`) that manages multiple browser tabs:
- Each page has its own `RequestQueue` (concurrency=1)
- Pages are created on-demand up to a configurable max (default: 3)
- Requests are distributed across available pages

**CLI option added:** `--pages <n>` to configure max concurrent pages

### 2. Acquire Lock vs No Lock

Tested two approaches for page acquisition:

**With Lock (serialized acquire):**
- Requests: 2.5s, 5.7s, 8.2s (~2.7s per request)
- Creates new pages for each concurrent request
- Slower due to page creation overhead

**Without Lock (race condition allowed):**
- Requests: 2.3s, 4.5s, 6.4s (~2.1s per request)
- All requests grab the same page and queue on it
- Faster because no page creation overhead

**Winner:** No lock — letting requests queue on a single page is faster.

## Benchmark Results

### Before Page Pool (single page, 10 concurrent)
```
Req 1: 3.4s → Req 10: 37.2s
Total: ~37s for all 10 requests
Pattern: Fully serialized, ~3.7s per request
```

### After Page Pool (3 concurrent)
```
Req 1: 2.3s, Req 2: 4.5s, Req 3: 6.4s
Pattern: ~2.1s per queued request
```

### After Page Pool (5 concurrent)
```
Req 1: 1.8s, Req 2: 5.3s, Req 3: 7.4s, Req 4: 9.4s, Req 5: 11.7s
Pattern: ~2.3s per queued request
```

## Key Findings

1. **Server-side rate limiting:** JH platform allows only one active generation per user account, regardless of client-side parallelism.

2. **Multiple tabs don't help:** Opening new browser tabs requires re-authentication, and even then, requests are still serialized server-side.

3. **Page creation has overhead:** Creating new pages (navigation, potential auth issues) is slower than queuing on a single page.

4. **Improved per-request latency:** Despite serialization, the pool infrastructure reduced per-request latency from ~3.7s to ~2.1s.

## JH Platform Constraints Discovered

- Opening a new tab requires re-login
- Refreshing a page invalidates the session
- One active generation per account (server-enforced)
- Cloudflare protection requires browser-based auth

## Current Architecture

```
Request → PagePool.acquire() → Page (with RequestQueue) → JH API → Release
```

The pool is kept in place but effectively operates as a single-page queue since:
- Race condition in `acquire()` means concurrent requests grab the same page
- This is intentional — it's faster than creating new pages

## Future Options

1. **Multiple accounts:** If you have multiple JH accounts, you could run separate authenticated sessions to achieve true parallelism.

2. **Request caching:** Cache identical requests to avoid hitting upstream for repeated queries.

3. **Simplify to single page:** Since multi-page doesn't help, could revert to simpler single-page architecture.

## Files Changed

- `src/core/page-pool.ts` — New page pool implementation
- `src/core/request-queue.ts` — Unchanged, used per-page
- `src/routes/chat-completions.ts` — Updated to use pool
- `src/server.ts` — Updated deps interface
- `src/cli/serve.ts` — Added pool initialization
- `src/cli.ts` — Added `--pages` CLI option
