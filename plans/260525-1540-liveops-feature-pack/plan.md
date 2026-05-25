---
title: "Liveops feature pack"
description: "Six high-ROI liveops features layered on existing cube-playground primitives: KPI hero strip, anomaly inbox, saved dashboards, diff/compare, cohort grid, funnel builder."
status: pending
priority: P1
branch: "main"
tags: [liveops, demo, kpi, anomaly, dashboards, cohort, funnel]
blockedBy: []
blocks: []
created: "2026-05-25T08:41:48.275Z"
createdBy: "ck:plan"
source: skill
---

# Liveops feature pack

## Overview

Convert cube-playground from a query/data-model viewer into a liveops console. Six features sequenced by demo ROI. Reuses existing primitives (Segments visuals, Fastify+sqlite server, game scoping). No new heavy infra — every phase is mostly wiring.

## Goals

- Show "game health at a glance" in <2s after page open.
- Surface anomalies without a human running queries.
- Let ops pin/share recurring views.
- Answer "did the new patch hurt X?" with one toggle.
- Demonstrate cohort + funnel — the two charts every game team asks for.

## Sequence (by demo ROI)

| Order | Phase | Why this slot |
|-------|-------|---------------|
| 1 | Live KPI hero strip | Pure wiring of existing primitives; biggest visual lift per hour |
| 2 | Anomaly inbox | Server stub + z-score util already exist; finishes a half-built feature |
| 3 | Saved dashboards | Multiplies every other feature's value; same sqlite/Fastify pattern |
| 4 | Diff / compare mode | Small, punchy; "patch impact" demo |
| 5 | Cohort retention grid | Higher Cube modeling effort; rolling-window measure |
| 6 | Funnel builder | Depends on ordered-funnel cube template being deployed; most setup |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Live KPI hero strip](./phase-01-live-kpi-hero-strip.md) | ✅ Completed |
| 2 | [Anomaly inbox](./phase-02-anomaly-inbox.md) | ✅ Completed |
| 3 | [Saved dashboards](./phase-03-saved-dashboards.md) | ✅ Completed |
| 4 | [Diff compare mode](./phase-04-diff-compare-mode.md) | ✅ Completed |
| 5 | [Cohort retention grid](./phase-05-cohort-retention-grid.md) | Pending |
| 6 | [Funnel builder](./phase-06-funnel-builder.md) | Pending |

## Cross-phase dependencies

- Phase 3 (Saved dashboards) requires Phase 1's `KpiTile` patterns + Phase 4's diff toggle to be valuable.
- Phase 2 (Anomaly inbox) "open in playground" deep-link consumes Phase 1's playground query-string format (already deep-linkable today).
- Phase 4 (Diff) is standalone but enriches every saved dashboard tile from Phase 3.
- Phase 6 (Funnel) requires ordered-funnel cube YAML to be deployed to the Cube backend (out of band, see `docs/ordered-funnel-cube-template.md`).

## Reused primitives (don't rebuild)

- `src/pages/Segments/visuals/`: `kpi-tile.tsx`, `sparkline.tsx`, `live-badge.tsx`, `bar-list.tsx`, `donut.tsx`, `line-chart.tsx`.
- `server/`: Fastify + better-sqlite3, migrations dir at `server/src/db/migrations/` (next id = 009).
- `server/src/services/z-score.ts`: existing rolling-stat util — Phase 2 consumer.
- `server/src/services/anomaly-state-store.ts` + `server/src/routes/anomaly-state.ts`: half-built route surface.
- `src/hooks/use-cube-token-bootstrap.ts` + `src/shared/game-scoping/apply-game-filter.ts`: game-scoped tokens + query injection.
- `src/pages/Segments/`: segment CRUD + activation pattern, reused by Phase 6.
- Playground deep-link (`/playground?query=…`): already URL-encoded JSON, used by Phase 2 + Phase 3.

## Unresolved questions

1. KPI strip placement: top of `/playground` (more discoverable) vs new `/liveops` route (cleaner)? Phase 1 assumes new `/liveops` to avoid crowding the query builder; switch is one route line.
2. Anomaly detector cadence: in-process node cron vs external scheduler? Phase 2 assumes in-process `setInterval` keyed by game, refreshed every 15min — KISS, fine for a demo, not multi-replica safe.
3. Pinned dashboards scope: per-user (needs auth model) vs per-game (shared)? Phase 3 assumes per-game shared, owner = `X-Owner` header (matches existing presets/segments pattern).
4. Cohort cube modeling: **decided** — Phase 5 requires a per-game `retention.yml` checked into `../cube-dev/cube/model/cubes/<game>/`. Each game has its own Trino schema, so this is a coordinated data-eng task (one PR per game, or a shared template + per-game refinement). Dev demo can shortcut via `schemaWriteMiddleware` to emit into a single game's local model dir. Note: `.env.example` ships `VITE_CUBE_MODEL_DIR=../cube/model` which is incorrect — the actual path is `../cube-dev/cube/model`. Fix that as part of Phase 5 prep.
5. Funnel ordered-cube deployment: who owns Cube YAML deploys? Phase 6 frontend ships zero-regression (falls back to multi-query funnel) but UX is dramatically better with ordered cube.
