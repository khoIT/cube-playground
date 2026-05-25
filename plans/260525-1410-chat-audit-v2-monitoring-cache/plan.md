---
title: "chat-audit v2: soft-delete + monitoring + response cache + settings tab"
description: "Soft-delete with 7-day retention, four monitoring features, exact-match response cache, chat-service settings tab"
status: completed
priority: P2
effort: 22.5h
branch: main
tags: [chat-service, observability, cache, dev-audit, settings]
created: 2026-05-25
updated: 2026-05-25
---

# Plan Overview — chat-audit v2

Extends the existing chat-audit triage UI and chat-service runtime with: safer
session deletion (recoverable for 7d), richer per-turn observability surfacing
(stop_reason, permission_decision, cache-hit %, token I/O), workflow tooling
(star/flag, cross-turn search, skill leaderboard), an exact-match response cache
to cut LLM cost on repeat queries, and a `/settings` "Chat Service" tab exposing
per-owner runtime toggles. Semantic cache deferred — internal LiteLLM proxy
does not expose an embedding model; revisit if exact-match hit-rate <10%.

## Phases

| ID | Title | Effort | Status | Depends |
|----|-------|--------|--------|---------|
| 01 | Soft-delete + resurrection (7d retention) | 3h | completed | — |
| 02 | Capture stop_reason + permission_decisions | 2.5h | completed | — |
| 03 | Cache-ratio + token-I/O on turn header | 1.5h | completed | 02 |
| 04 | Star/flag + cross-turn search | 4h | completed | — |
| 05 | Skill leaderboard view | 3h | completed | 02 |
| 06 | Response cache — exact-match (v1) | 6h | completed | 02, 03 |
| 08 | Chat-service settings tab | 2.5h | completed | 06 |

Phases 01, 02, 04 are independent and can be cooked in parallel.
03/05 depend on 02 (stop_reason on `chat_turns`).
06 depends on 02 (stop_reason gate for write-on-success) and 03 (cache_creation/read column population).
08 depends on 06 (cache bypass + clear endpoints are no-ops without the cache).

## Key Dependencies

- chat_turns FK ON DELETE CASCADE — verified at schema.sql:24 — soft-delete must NOT trigger the cascade
- snapshot-store contract — tombstones are authoritative; hard-purge must continue writing them
- BufferedLlmTraceRecorder + observer hooks — extension seam for permission decisions
- `cube-meta-cache.ts` — needs a derived `version` (currently has none) for cache invalidation hash
- `services/scheduler.ts` — node-cron; reuse for retention sweep + cache TTL purge

## Cross-cutting Constraints (apply to every phase)

- SSE wire format MUST stay byte-identical (especially cache replay in 06)
- DB migrations additive only — never DROP
- Every code file < 200 LOC (modularize aggressively)
- No new auth surface — reuse X-Owner-Id
- Cache off by default in tests via `RESPONSE_CACHE_ENABLED` gate

## Risk Heat-map

| Risk | Phase | Likelihood | Impact | Mitigation |
|------|-------|-----------|--------|-----------|
| Per-game cache leaks PII across owners | 06 | M | H | Document threat model; PII redaction audit pre-ship; tests covering owner isolation of *read-back* metadata |
| Clear-my-cache wipes shared cache for other owners | 08 | H | M | Confirm dialog explains scope; toast shows deleted count; rate-limited |
| Soft-delete leaks deleted sessions into list endpoints | 01 | M | H | Single guard predicate `deleted_at IS NULL` added to every owner-facing query; integration test enumerates all callers |
| Retention sweeper races chat-snapshot write | 01 | L | M | Sweep runs inside same DB; tombstone write happens at purge step, identical to v1 path |
| Cache replay drifts from live SSE shape | 06 | L | H | Golden-event-stream test; replay helper shares the same `writeSseEvent` writer |
| Arbitrary `X-Model` header bypasses model policy | 08 | L | M | Server-side allowlist via `config.allowedModels`; unknown values silently fall back to default |

## Success Criteria (rollup)

- Deleted sessions visible in /dev/chat-audit with restore-button; main chat UI does NOT show them
- Every assistant turn row in /dev/chat-audit shows stop_reason pill + (when present) permission_decisions list
- Turn header shows cache-hit % and I/O ratio when data is available; gracefully drops otherwise
- Star/flag round-trips through API and persists; search returns hits across user+assistant text + tool args
- /dev/chat-audit/leaderboard renders ≤ 1s for 30d-window aggregate
- Cache hit reduces wall-clock turn latency to < 200ms and shows "Cache hit" badge with link to original turn
- `/settings` shows a "Chat Service" tab with model selector, cache bypass + clear, and the two UI toggles; each round-trips correctly

## Docs Impact

- `docs/system-architecture.md` — add a "Response cache" section once phase 06/07 ship
- `docs/code-standards.md` — note the cache-key normalization rules

## Files

- phase-01-soft-delete-and-resurrection.md
- phase-02-capture-stop-reason-and-permission-decisions.md
- phase-03-cache-ratio-and-token-io-turn-header.md
- phase-04-star-flag-and-search-turns.md
- phase-05-skill-leaderboard.md
- phase-06-response-cache-exact-match.md
- phase-08-chat-service-settings-tab.md

## Completion Summary

**Test Coverage**: 1386 total tests passing (424 chat-service + 962 root). Chat-service expanded from baseline to 427 tests via 7 phases.

**Estimated LOC Added**: ~2400 lines of code across backend services, database migrations, API routes, and frontend components (distributed: schema/migrations ~150, observability capture ~280, cache logic ~450, search/annotations ~320, leaderboard ~280, settings UI ~400, tests ~520).

**Key Implementation Decisions**:
- **Stop reason capture**: Fixed upstream bug where `emitLlmCall` hardcoded `stopReason: undefined` — moved capture to result message level (per SDK contract), stored on chat_turns for turn-level queries.
- **Cache scope**: Locked at per-game (across owners) with documented PII risk. User_text is shared; pre-ship PII redaction audit required before enabling in production.
- **Semantic cache deferred**: v2 uses exact-match only. Internal LiteLLM proxy lacks embedding model; semantic layer deferred to v3 pending hit-rate validation.
- **Annotations stored dev-local**: turn_annotations table is owner-scoped but NOT synced to snapshot — accepted trade-off (cross-machine sync requested future only).

**Deferred from Code Review**: N4–N7 issues (lower-priority observability + performance polish):
- N4: Missing verbose logging for cache hits/misses
- N5: Replay chunking tunable via env var (started with 80-char hardcoded)
- N6: `cube_meta_hash` invalidation could be moved to startup vs on-lookup
- N7: Permission decision scrubbing for tool args truncation
