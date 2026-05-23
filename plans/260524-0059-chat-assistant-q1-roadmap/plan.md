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
| 05 | [monitoring-infra](./phase-05-monitoring-infra.md) | B — Backend | pending |

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
F12 team glossary, F14 threshold alerts, F15 drift, F16 digest, F17 CDP publish, F18 MCP, F19 permalink/comments, F20–F22 UX polish.

## Success criteria (rollup)
- Non-tech user runs all 16 business questions end-to-end without SQL.
- Every emitted segment cites catalog id.
- User overrides persist per-user × per-game across sessions.
- Saved segments refresh on schedule with audit trail.
- Audit query: zero parallel-truth segment definitions.

## Open questions (resolve in M1 design)
1. Scheduler location — chat-service vs main server (`server/src/jobs/cron-runner.ts` already exists; lean toward reuse).
2. Persona detection — user-selected first-login vs behavior-inferred.
3. Per-game memory scoping — opt-in transfer across games (recommend NO default).
4. CDP API readiness for Q2 F17 — confirm with CDP team before Q2 commit.
5. Notification dispatch surface in M3 — in-app toast only (recommended) vs also email.
