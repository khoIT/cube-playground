---
phase: 5
title: "Server stream-registry + uuid turnId"
status: completed
priority: P2
effort: "1d"
dependencies: [4]
---

# Phase 5: Server stream-registry + uuid turnId

## Overview

Backend foundation for refresh-resume. Add an in-memory registry that records every SSE event per turn, with TTL + size caps. Harden turnId to UUID v4 so it's unguessable.

<!-- Updated: Validation Session 1 - defaults are config-driven (Q3); alias map for compact session swap (Q1) -->
## Requirements

- Functional:
  - `chat-service/src/core/stream-registry.ts` exposes `register(turnId, sessionId)`, `append(turnId, event)`, `finish(turnId, status)`, `get(turnId)`, `subscribe(turnId, listener) → unsubscribe`, `aliasSession(oldSessionId, newSessionId)`, `findRunning(sessionId)`.
  - Ring buffer per turn: cap N events (configurable, default 2000) — oldest discarded; new attachees still see `from=<offset>` correctly relative to TOTAL emitted count, not buffer offset (so clients always replay only what's available, contiguous from `fromAvailableOffset`).
  - Global cap: max M concurrent turns (default 100). Reject new register if exceeded (log + alert).
  - TTL: entry removed N seconds after `finish` (default 300s = 5 min). Background sweeper interval (default 60s).
  - **Compact alias map (Q1):** When `compactSession` swaps `oldSessionId → newSessionId` mid-turn (`chat-service/src/api/turn.ts:113`), the turn handler calls `streamRegistry.aliasSession(oldSessionId, newSessionId)`. Registry maintains a `Map<oldSessionId, newSessionId>` (TTL'd with the turn entry). `findRunning(sessionId)` resolves through the alias chain before scanning running entries — so a client refresh holding the old sessionId still finds the live turn.
- Non-functional:
  - Defaults exposed via `chat-service/src/config.ts` (env-overridable: `STREAM_REGISTRY_RING_SIZE`, `STREAM_REGISTRY_MAX_TURNS`, `STREAM_REGISTRY_TTL_MS`, `STREAM_REGISTRY_SWEEP_INTERVAL_MS`).
  - Zero new I/O. Pure in-process.
  - `turnId` becomes UUID v4 — change from `sessionId:index`. Verified: no downstream code in `chat-service/src/` parses turnId as a composite (rg returns no matches).
  - Existing callers that read `turnId` (`chat-store.appendTurn`, `audit.ts:insertAudit`) accept opaque strings (confirmed at `chat-store.ts:296`).

## Architecture

```
turn.ts handler
  ├─ const turnId = randomUUID()             // v4
  ├─ streamRegistry.register(turnId)
  ├─ for each emit(event) {
  │     streamRegistry.append(turnId, event)
  │     write SSE to client
  │  }
  └─ on done/error/abort:
        streamRegistry.finish(turnId, status)
        // ring buffer kept for TTL window
```

Per-turn entry:

```ts
type RegistryEntry = {
  turnId: string;
  sessionId: string;            // CURRENT sessionId (post-compact)
  status: 'running' | 'done' | 'error';
  events: SseEvent[];           // ring; bounded
  startOffset: number;          // count of dropped-from-head events
  totalEmitted: number;
  createdAt: number;
  finishedAt?: number;
  listeners: Set<(event: SseEvent) => void>;
};

// Module-level: alias chain for compacted sessions.
// Lifetime: entry pruned with its turn entry on TTL eviction.
type SessionAlias = Map<string /* oldSessionId */, string /* newSessionId */>;
```

## Related Code Files

- Create: `chat-service/src/core/stream-registry.ts` (~150 LOC; if larger split into `stream-registry.ts` + `stream-registry-sweeper.ts`).
- Modify: `chat-service/src/api/turn.ts` — switch to UUID v4 turnId; call `register`/`append`/`finish`; emit new event `turn_started { turnId }` after `session_created`. **After auto-compact session swap at line 113**, call `streamRegistry.aliasSession(oldSessionId, newSessionId)` BEFORE `register(turnId, newSessionId)`.
- Modify: `chat-service/src/config.ts` — add ring-size / max-turns / TTL / sweep-interval env knobs.
- Modify: `chat-service/src/types.ts` — add `'turn_started'` to SseEvent union with `{ turnId: string }`.
- Modify: `chat-service/src/db/chat-store.ts` — confirm `appendTurn` params accept arbitrary turnId string (sanity check, likely no change).
- Modify: `chat-service/src/api/audit.ts` — same sanity check.
- Read for context: `chat-service/src/api/turn.ts:174-227`, `chat-service/src/core/sse-stream.ts:80-142`.

## Implementation Steps

1. Implement `stream-registry.ts`: Map<turnId, RegistryEntry>; ring buffer via simple array + offset arithmetic.
2. Implement `subscribe(turnId, listener)`: pushes listener into entry; returns disposer.
3. Implement TTL sweeper: `setInterval` (cleared on shutdown via existing chat-service lifecycle hook); on each tick, drop entries where `status !== 'running' && now - finishedAt > TTL`.
4. Switch `turn.ts` turnId generation to `randomUUID()` from `crypto`.
5. Emit `turn_started { turnId }` event immediately after `session_created` (so client has stable handle from the very first frame).
6. Wire `register` / `append` / `finish` into the turn lifecycle. In the existing finally block (~`turn.ts:350`), ensure `finish` is called once on all exit paths (done, error, abort).
7. Unit tests for registry: append-then-replay, ring-buffer overflow (verify `startOffset` math), TTL eviction, global cap enforcement, listener fan-out, **alias resolution** (alias `old→new`, `findRunning(old)` returns the entry registered under `new`).
8. Confirm DB and audit log still accept new opaque turnId.
9. Wire `aliasSession` call into the compact branch of `turn.ts` (between line 113 and `register()`).

## Success Criteria

- [x] `stream-registry.ts` unit tests green, cover overflow, TTL, listener fan-out, alias resolution.
- [x] `turn.ts` emits UUID v4 turnId via `turn_started` event before any token.
- [x] After compact, `findRunning(oldSessionId)` resolves alias and returns the new entry.
- [x] Config knobs (`STREAM_REGISTRY_*`) honored end-to-end.
- [x] No DB/audit regressions (existing chat-service tests still pass).
- [x] Memory: 100 concurrent 2000-event turns < ~50MB RSS delta (back-of-envelope; verify with a load test).

## Risk Assessment

- Risk: changing turnId format breaks something downstream reading the `sessionId:index` shape. Mitigation: grep first; if any consumer parses it, refactor before the swap.
- Risk: ring buffer offset bug — client requests `from=K` where K < startOffset → replay must reject or clamp + tell client "data lost". Mitigation: replay endpoint (Phase 6) returns 409 with `availableFromOffset` so client can start fresh.
- Risk: sweeper not cleaned on test teardown → flaky tests. Mitigation: registry exposes `dispose()`; tests call it in `afterEach`.

## Security Considerations

- UUID v4 turnId prevents cross-session probing. Combined with auth check on the replay endpoint (Phase 6), only the owner can attach.
- Registry holds tokens-in-flight in memory; ensure no sensitive payload is logged on append.
