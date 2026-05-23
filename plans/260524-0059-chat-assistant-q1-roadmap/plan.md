---
title: "Chat Assistant Q1 Roadmap — Trust-first (Shape α)"
description: "M1 Discovery + Infra → M2 Question Studio → M3 Memory + Saved Monitored Segments. Catalog-consistency enforced."
status: pending
priority: P1
effort: ~12w (3 milestones × ~4w)
branch: new_design
tags: [chat-assistant, catalog, segments, memory, monitoring, q1-roadmap]
created: 2026-05-24
---

# Chat Assistant Q1 Roadmap

Source brainstorm: [brainstorm-260524-0059-chat-assistant-quarter-roadmap.md](../reports/brainstorm-260524-0059-chat-assistant-quarter-roadmap.md)

## Shape
**α Trust-first** — verification before automation. Rejected β (memory-first) and γ (operationalize-fast).

## Catalog-consistency rule (NON-NEGOTIABLE)
Every chat-emitted segment/metric reference cites a catalog id (`business_metrics/<id>`). User overrides create a divergence flag, not hidden parallel definitions. No chat-side definitions stored independently of catalog. Enforced in phase-06 (editable plan) + phase-11 (glossary memory) + e2e audit test.

## Milestones

### M1 — Discovery + Infra Foundation (~4w, parallel tracks)
| # | Phase | Track | Status |
|---|---|---|---|
| 01 | [discovery-starter-library](./phase-01-discovery-starter-library.md) | A — UI | pending |
| 02 | [schema-cartographer](./phase-02-schema-cartographer.md) | A — UI | pending |
| 03 | [concept-glossary](./phase-03-concept-glossary.md) | A — UI | pending |
| 04 | [suggested-followups](./phase-04-suggested-followups.md) | A — UI | pending |
| 05 | [monitoring-infra](./phase-05-monitoring-infra.md) | B — chat-service Backend | pending |

### M2 — Question Studio (~4w)
| # | Phase | Status |
|---|---|---|
| 06 | [editable-execution-plan](./phase-06-editable-execution-plan.md) — CRITICAL catalog-consistency | pending |
| 07 | [sample-member-preview](./phase-07-sample-member-preview.md) | pending |
| 08 | [plain-english-filter-trace](./phase-08-plain-english-filter-trace.md) | pending |
| 09 | [sanity-check-assistant](./phase-09-sanity-check-assistant.md) | pending |

### M3 — Memory + Saved Monitored Segments (~4w)
| # | Phase | Status |
|---|---|---|
| 10 | [persistent-chat-history](./phase-10-persistent-chat-history.md) | pending |
| 11 | [user-glossary-memory](./phase-11-user-glossary-memory.md) | pending |
| 12 | [saved-monitored-segments](./phase-12-saved-monitored-segments.md) — uses phase-05 infra | pending |
| 13 | [recents-rail](./phase-13-recents-rail.md) | pending |

## Phase dependency graph
```
M1: 01,02,03,04 (Track A — parallel) ╮
    05 (Track B — parallel)          ├─► M2: 06 ─► 07,08 (parallel) ─► 09
                                     │
                                     ╰─► M3: 10 ─► 11; 12 (needs 05+06); 13 (needs 10+12)
```
- 06 blocked by 03 (glossary catalog mapping) + 02 (schema map).
- 07,08 blocked by 06 (consumes editable plan output).
- 11 blocked by 06 (divergence flag schema) + 10 (history infra share DB).
- 12 blocked by 05 (scheduler) + 06 (segment definition is catalog-cited).
- 13 blocked by 10 (history) + 12 (saved segments).

## Deferred to Q2 (do NOT plan in Q1)
F12 team glossary, F14 threshold alerts, F15 drift, F16 digest, F18 MCP, F19 permalink/comments, F20–F22 UX polish. (F17 CDP publish removed; chat uses deeplink-only integration.)

## Success criteria (rollup)
- Non-tech user runs all 16 business questions end-to-end without SQL.
- Every emitted segment cites catalog id.
- User overrides persist per-user × per-game across sessions.
- Saved segments refresh on schedule with audit trail.
- Audit query: zero parallel-truth segment definitions.

## Resolved decisions

| # | Question | Decision | Affected phase(s) |
|---|---|---|---|
| Q1 | Scheduler location | New scheduler in chat-service (node-cron); refresh handlers HTTP-call main server's existing refresh endpoint. | 05, 12 |
| Q2 | Persona detection | Behavior-inferred from topic histogram after ≥3 sessions; cold-start shows all 16 starters. No manual picker UI Q1. | 01 |
| Q3 | Per-game memory transfer | NO cross-game transfer at all in Q1 (not even opt-in stub). Deferred entirely to Q2. | 11 |
| Q4 | CDP API for F17 | F17 DROPPED from Q2 entirely. Chat uses deeplink-only for CDP integration. | plan.md (deferred list) |
| Q5 | Notification surface | In-app toast only Q1. Email/Slack deferred to Q2. Driver interface stays narrow. | 05 |
| Q6 | Embedding model | TF-IDF via SQLite FTS5 only. No vector table, no embedding worker. Semantic embeddings deferred to Q2. | 10 |
| Q7 | DB location | All new tables in chat-service SQLite (notifications, monitoring_audit, glossary_overrides, starter_history, monitored_segments). NOT in server's segments.db. | 05, 10, 11, 12 |
| Q8 | Field-chip token | `{{field:cube.member}}` LOCKED. | 02 |
| Q9 | Monitored-segment storage | New `monitored_segments` table in chat-service DB. Links by `segment_id` foreign-ref-by-id (cross-DB; no FK). NOT extending `segments` table. New `monitored_segment_runs` history table in chat-service DB. | 12 |
| Q10 | Starter click | Prefill composer (NO auto-submit). User edits then sends manually. | 01 |
| C1 | Migration composition | Single migrate driver `chat-service/src/db/migrate.ts` imports + runs each phase's `migrateXxx(db)` in fixed order (notifications → monitoring_audit → glossary_overrides → chat_turns_fts triggers → monitored_segments + runs). Idempotent. | 05, 10, 11, 12 |
| C2 | Auth chat-service → main-server HTTP | Shared service token via env `MAIN_SERVER_SERVICE_TOKEN`. chat-service sends `Authorization: Bearer <token>` + `X-Owner-Id` header for audit attribution. Main server validates via middleware. | 05, 12 |
| C3 | Cross-DB ref drift on segment delete | Reactive cleanup on refresh tick: 404 from `POST /api/segments/:id/refresh` → set `monitored_segments.last_status='segment_deleted'`, emit one final deletion notification, future ticks filter row out via index. No webhook. | 12 |
| C4 | Scheduler library | `node-cron` (LOCKED). Add to `chat-service/package.json` deps. | 05 |
| C5 | Cold-start threshold for starter ranking | Config constant `STARTER_RANK_MIN_SESSIONS = 3` in `chat-service/src/config.ts`. Single source of truth — no env var, no DB row. | 01 |
