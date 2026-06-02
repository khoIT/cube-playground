---
title: "Unified Cache Service (kv_cache + 5 surfaces + audit follow-ups)"
description: "Consolidate response cache + 4 new local cache surfaces under one kv_cache table, wire Anthropic prompt cache, fix N2/N4 in dashboard aggregates."
status: pending
priority: P2
effort: 5–7d
branch: main
tags: [chat-service, caching, devaudit, observability]
created: 2026-05-25
---

# Unified Cache Service — Plan Overview

Single cache service unifying response cache + 4 new local surfaces + Anthropic native prompt cache, with two audit-redesign follow-ups (N2 current-hash, N4 deleted-session leak) folded in.

**Locked decisions** (from request): one `kv_cache` table with per-kind adapters; existing `response_cache` table stays for migration window; flag `CACHE_SERVICE_ENABLED` with one-release alias `RESPONSE_CACHE_ENABLED`; prompt cache exempt under separate `ANTHROPIC_PROMPT_CACHE_ENABLED`.

**Research findings** (see `research/`):
- `researcher-01` — Claude Agent SDK v0.3.150 does NOT expose `cache_control`. Phase 02 pivots to verifying/stabilising the SDK's automatic prefix cache + adding a kill-switch nonce.
- `researcher-02` — Soft-delete column verified at `chat_sessions.deleted_at`; all 6 aggregate query functions miss the filter (N4). N2 fix: `currentMetaHash` returns `null` when no `gameId` selected.

## Phases

| # | Phase | Status | Effort | File ownership (root: chat-service/src or src) |
|---|-------|--------|--------|----------------|
| 01 | [kv-cache schema + base service + flag rename](./phase-01-kv-cache-schema-and-service.md) | pending | 1d | `db/kv-cache-migrate.ts`, `db/kv-cache-store.ts`, `cache/kv-cache-service.ts`, `config.ts` |
| 02 | [Anthropic prompt cache verify + stabilise + kill-switch](./phase-02-anthropic-prompt-cache.md) | pending | 0.5d | `core/claude-runner.ts`, `core/mode-prompts.ts`, `config.ts` |
| 03 | [/load result cache adapter](./phase-03-load-result-cache.md) | pending | 1d | `cache/adapters/load-cache.ts`, `tools/preview-cube-query.ts`, `cache/refresh-cached-artifacts.ts` |
| 04 | [Title + compaction sub-LLM dedup cache](./phase-04-title-and-compaction-cache.md) | pending | 1d | `cache/adapters/title-cache.ts`, `cache/adapters/compaction-cache.ts`, `core/title-summariser.ts`, `core/compact-service.ts`, `api/turn.ts` (title call site) |
| 05 | [Turn-detail audit cache](./phase-05-turn-detail-cache.md) | pending | 0.5d | `cache/adapters/turn-detail-cache.ts`, `api/debug.ts`, `db/chat-store.ts` (delete hook) |
| 06 | [Dashboard aggregates by kind + N2/N4 fixes](./phase-06-dashboard-aggregates-by-kind-and-followups.md) | pending | 1.5d | `db/cache-effectiveness-queries.ts`, `db/cache-effectiveness-store.ts`, `src/api/cache-effectiveness-types.ts`, `src/pages/DevAudit/cache-*` |
| 07 | [Tests + rollout](./phase-07-tests-and-rollout.md) | pending | 0.5d | `chat-service/test/cache/*`, docs |

## Dependency Graph

```
phase-01 (schema + service + flag)
   ├─► phase-02 (prompt cache — independent of kv_cache, can land in parallel)
   ├─► phase-03 (load adapter)
   ├─► phase-04 (title + compaction adapters)
   ├─► phase-05 (turn-detail adapter)
   └─► phase-06 (dashboard) — needs adapters in 03–05 so kind aggregates have data;
                              N2/N4 SQL fixes are independent and can land first.
phase-07 (tests + rollout) — final, gates production flag flip.
```

After phase-01 merges to main, phases 02 / 03 / 04 / 05 / 06-SQL-only can proceed in parallel (no file overlap — see ownership column). Phase 06-FE depends on at least one adapter from 03–05 emitting `kind` data for the breakdown to show non-zero buckets.

## Top-3 Risks (ranked)

1. **Prompt cache SDK gap (Phase 02)** — `@anthropic-ai/claude-agent-sdk` v0.3.150 doesn't expose `cache_control`. We rely on the SDK's automatic prefix cache. If contextPreamble JSON ordering rotates per turn, cache silently misses with no warning. Mitigation: stabilise prefix bytes + add a byte-equality snapshot test + surface `cache_creation_tokens` / `cache_read_tokens` in DevAudit so regressions are visible.
2. **PII leak via title/compaction caches (Phase 04)** — both cache surfaces key on `owner_id + hash(messages)`, but `value_json` stores the LLM output which can contain user-private text fragments. Cross-owner replay is the danger. Mitigation: owner-scoped lookup (lookup MUST include owner_id in WHERE clause, not just key prefix), per-kind ON/OFF gate, redaction audit checklist in phase-07.
3. **/load cache staleness vs cube meta drift (Phase 03)** — cache key includes `cubeMetaHash`, but if the user updates a measure definition between query and refresh, cached rows could mislead. TTL is 5–10m; meta-hash rotation invalidates. Mitigation: lookup MUST re-read current meta hash before returning row (same pattern as response_cache); fallthrough on hash mismatch.

## Acceptance for the Plan

- [x] Phases independently mergeable after phase 01
- [x] No phase file exceeds 200 lines (target ≤180 each)
- [x] Migration reversible (down SQL provided in phase-01)
- [x] Each surface has kill switch (`CACHE_SERVICE_ENABLED` global + per-kind disable list `CACHE_KINDS_DISABLED=title,compaction`)
- [x] PII handling called out per phase
