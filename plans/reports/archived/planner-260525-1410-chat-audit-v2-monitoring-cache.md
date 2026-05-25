# Planner Report — chat-audit v2: soft-delete + monitoring + cache

**Plan dir:** `plans/260525-1410-chat-audit-v2-monitoring-cache/`
**Date:** 2026-05-25
**Branch:** main

## Phases (7 total)

| # | Title | Effort | Depends | LOC est (FE+BE+tests) |
|---|-------|--------|---------|-----------------------|
| 01 | Soft-delete + resurrection (7d retention) | 3h | — | ~350 |
| 02 | Capture stop_reason + permission_decisions | 2.5h | — | ~300 |
| 03 | Cache-ratio + token-I/O on turn header | 1.5h | 02 | ~180 |
| 04 | Star/flag + cross-turn search | 4h | — | ~650 |
| 05 | Skill leaderboard | 3h | 02 | ~500 |
| 06 | Response cache exact-match | 6h | 02, 03 | ~800 |
| 07 | Response cache semantic | 8h | 06 | ~600 |

Total est: ~28h, ~3380 LOC across BE/FE/tests.

## Dependency graph

```
01 (independent)
02 (independent) ── 03 ─┐
                        ├─ 06 ─── 07
                        │
04 (independent — sequenced before 05 on dev-audit-page.tsx)
05 (after 02; after 04 on dev-audit-page.tsx)
```

**Parallel-safe groups (no file conflict):**
- Group A: 01 + 02 + 04 (touch different files except dev-audit-page.tsx — phase 04 owns its edits there)
- Group B (after 02 lands): 03 + 05 (different FE files)
- Group C (after 03 + 02 land): 06, then 07 (sequential)

**Sequenced-only edges** (do NOT parallelize — same file):
- 04 → 05 both touch `src/pages/DevAudit/dev-audit-page.tsx`
- 06 → 07 both touch `chat-service/src/api/turn.ts` and response-cache table
- 02 → 03 both touch `chat-service/src/db/migrate.ts` (additive migrations append in sequence)

## Top risks (rolled up across phases)

| Rank | Risk | Phase(s) | Mitigation |
|------|------|----------|-----------|
| R1 | PII leaks across owners via per-game shared cache | 06, 07 | Pre-ship redaction audit; document `RESPONSE_CACHE_OWNER_SCOPED` env fallback; banner in /dev/chat-audit |
| R2 | False semantic cache hits return inappropriate cached answer | 07 | Tight 0.95 threshold, env-tunable; Bypass-cache header; sim% surfaced in UI |
| R3 | Soft-delete misses a query path → deleted sessions leak to chat UI | 01 | Explicit grep enumeration of callers; integration test |
| R4 | SSE replay drifts from live shape (cache hit looks different) | 06 | Golden-event-stream comparison test; shared writeSseEvent writer |
| R5 | sqlite-vec native binding fragile on dev OS | 07 | Locked decision: brute-force Node-side cosine (avoids extension); schema future-proofed for later swap |
| R6 | Phase 02 SDK shape assumption for permission_decision is wrong | 02 | Step 8 verifies via raw sdk_events JSON before coding the extractor |

## Verified codebase claims

- `deleteSession` at `chat-store.ts:79` is hard DELETE with tombstone write — confirmed
- `chat_turns` FK at `schema.sql:24` is `ON DELETE CASCADE` — confirmed
- `llm_calls.stop_reason` column already exists at `observability-migrate.ts:30`; bug is upstream — `sdk-event-extractor.ts:67` sends `stopReason: undefined` — confirmed
- `cube-meta-cache.ts` has no version field — confirmed (needs `getMetaVersion()` addition in phase 06)
- `scheduler.ts` is node-cron-based and ready for new registrations — confirmed
- Snapshot pipeline at `snapshot-store.ts` treats tombstones as authoritative — confirmed (phase 01 preserves)
- `SdkResultMessage.usage` exists at `sse-stream.ts:62` but does NOT read cache_creation_input_tokens / cache_read_input_tokens — confirmed (phase 03 reads them)
- `BufferedLlmTraceRecorder` flushes after appendTurn — confirmed (phase 02 reuses pattern)
- chat-service file ownership: `api/sessions.ts` is sole writer of DELETE handler; `api/debug.ts` is sole reader of debug routes; `core/turn.ts` orchestrates lifecycle — confirmed

## Backwards compatibility

- All migrations additive (ALTER ADD COLUMN with `addColumnIfMissing` + CREATE TABLE IF NOT EXISTS). Zero DROPs.
- Snapshot pipeline: v2 → v3 in phase 01 (adds `deleted_at` per session). Older snapshots hydrate normally (missing field → null → not deleted).
- Existing observability tests should pass without modification; new optional hooks (`onTurnFinalized`, `onPermissionDecision`) don't break older observer impls.
- Caches default off (`RESPONSE_CACHE_ENABLED` and `RESPONSE_CACHE_SEMANTIC_ENABLED` both false). Phase 06/07 ship dark and are flipped on per env after PII audit.
- SSE wire format unchanged — replay test guarantees byte-identical events.

## Rollback strategy per phase

| Phase | Rollback |
|-------|----------|
| 01 | Revert `migrate.ts` ALTER no-op; revert handler to call hard-delete. Sweep job is unregistered automatically when scheduler.register is removed. `deleted_at` column lingers harmlessly. |
| 02 | Recorder hooks are optional — disabling them reverts to prior behavior. New table stays empty. |
| 03 | FE-only revert undoes display; columns linger harmlessly with NULL. |
| 04 | Revert FE imports; new tables stay (orphaned data but harmless). |
| 05 | Revert FE route + plugin registration. |
| 06 | Set `RESPONSE_CACHE_ENABLED=false`. Lookup branch becomes no-op; existing turns unaffected. |
| 07 | Set `RESPONSE_CACHE_SEMANTIC_ENABLED=false`. Same as 06. |

## Test matrix per phase (summary)

| Phase | Unit | Integration | E2E |
|-------|------|-------------|-----|
| 01 | softDelete/restore/purge | DELETE-then-GET; restore; sweep tick | manual: chat UI hides deleted, dev-audit shows them |
| 02 | extractor outputs | observer hook flush order | turn with tool_use → pill colored amber |
| 03 | formatTurnStats edge cases | SDK shape extraction | manual: real turn shows cache % |
| 04 | annotations store; search cursor | search owner isolation; cross-turn search hits all 4 source columns | star→reload→still starred |
| 05 | percentileSorted edge cases | owner isolation; days window bound | leaderboard renders < 1s for 30d |
| 06 | key normalize; replay chunking | hit replay byte-identical; bypass header; tool-call skip-cache; error skip-cache | repeat prompt → < 200ms second response |
| 07 | cosine; BLOB round-trip; provider timeout degrade | exact-miss + semantic-hit; threshold edge; model-bump invalidation | semantic-similar prompt shows correct badge |

## Behavioral checklist (rolled up — see CLAUDE.md gate)

- [x] Data flows documented per phase (Architecture sections)
- [x] Dependency graph complete (above + plan.md)
- [x] Risk × impact assessed; mitigations stated per High risk
- [x] Backwards compat: additive migrations only; cache gated off
- [x] Test matrix defined (above + per-phase tests)
- [x] Rollback plan exists per phase (above)
- [x] File ownership assigned; sequencing noted where conflicts exist
- [x] Success criteria measurable per phase

## Unresolved questions

1. Exact SDK message shape for permission decisions — phase 02 step 8 verifies via raw sdk_events before implementing.
2. Confirm SDK `result.usage` key names for cache tokens (cache_creation_input_tokens vs cache_creation_tokens) — phase 03 step 2 verifies live.
3. Compose-page location of "Bypass cache" toggle — phase 06 step 10 reads compose component during implementation.
4. Whether annotations should propagate via chat-snapshot.json — locked NO for v2; flagged for re-eval later.
5. **(BLOCKING for phase 07 cook)** Pre-cook checklist re-confirmation: OpenAI vs Voyage, 0.95 threshold, brute-force vs sqlite-vec, per-game scope, PII audit sign-off. Phase 07 should not start without these.

## Sources (research used in phase 07)

- [voyage-3-lite vs OpenAI 3-small benchmark — buildmvpfast.com](https://www.buildmvpfast.com/blog/best-embedding-model-comparison-voyage-openai-cohere-2026)
- [Embedding pricing comparison — pecollective.com](https://pecollective.com/tools/text-embedding-models-compared/)
- [Voyage 3.5 vs OpenAI comparison — agentset.ai](https://agentset.ai/embeddings/compare/voyage-35-vs-openai-text-embedding-3-small)
- [sqlite-vec js docs — alexgarcia.xyz](https://alexgarcia.xyz/sqlite-vec/js.html)
- [@dao-xyz/sqlite3-vec wrapper — npm](https://www.npmjs.com/package/@dao-xyz/sqlite3-vec)
- [sqlite-vec Windows binding issue — GitHub](https://github.com/openclaw/openclaw/issues/65704)

**Status:** DONE
**Summary:** Created 7 phase docs + overview plan + this report under `plans/260525-1410-chat-audit-v2-monitoring-cache/`. Phases 01/02/04 parallelizable; 03/05/06/07 sequenced. Total est 28h. Phase 07 flagged for pre-cook re-confirmation due to highest semantic-cache risk.
