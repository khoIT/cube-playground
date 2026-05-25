---
title: Liveops polish + result caching
description: >-
  Three follow-ons to the liveops feature pack: huashu-design UI pass for
  /liveops surfaces; server-side result cache for KPI/cohort/funnel mirroring
  the Segments card-cache pattern; Dashboard tile cache; funnel+retention
  follow-on improvements.
status: pending
priority: P1
branch: main
tags:
  - liveops
  - polish
  - caching
  - ux
  - performance
  - funnel
  - retention
blockedBy: []
blocks: []
created: '2026-05-26T02:39:00.000Z'
createdBy: 'ck:plan'
source: skill
---

# Liveops polish + result caching

## Overview

The 6-phase liveops pack landed. Three things now make the demo land harder:
1. **UI redesign** — Phase 1 of the pack reused Segments primitives but never had a proper design pass. The `/liveops*` surfaces look "componenty", not curated.
2. **Stop hammering Trino** — every `/liveops` open issues 5+ Cube queries; every cohort grid issues 1 query for ~28k users × 28 days; every funnel does 1 UNION across 4 etl tables. None of this is cached server-side. The Segments page already solved this with `segment_card_cache` + `refresh-segment.ts` cron job — mirror that pattern.
3. **Funnel + retention now in place** — both cubes ship. Multiplier opportunity: cohort × funnel mash-up, funnel templates, cross-game funnel diff, retention-curve anomalies.

## Sequence

| Order | Phase | Why this slot |
|-------|-------|---------------|
| 1 | UI redesign (huashu-design) | Independent; biggest visual hit per dev-day |
| 2 | Liveops result cache | Trino cost driver — fix before adopting widely |
| 3 | Dashboard tile cache | Mirrors Phase 2 pattern; depends on it landing first |
| 4 | Funnel + retention follow-ons | Best done after caching so iterations are fast |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [UI redesign with huashu-design](./phase-01-ui-redesign-with-huashu-design.md) | Pending |
| 2 | [Liveops result cache](./phase-02-liveops-result-cache.md) | Pending |
| 3 | [Dashboard tile cache](./phase-03-dashboard-tile-cache.md) | Pending |
| 4 | [Funnel + retention follow-on improvements](./phase-04-funnel-retention-follow-on-improvements.md) | Pending |
| 5 | [Dashboard starter pack](./phase-05-dashboard-starter-pack.md) | Pending |
| 6 | [Settings tabs for Liveops and Dashboards](./phase-06-settings-tabs-for-liveops-and-dashboards.md) | Pending |

## Reused primitives

- `server/src/services/card-cache-store.ts` — `upsertCardCache` w/ hash-skip writes
- `server/src/jobs/refresh-segment.ts` — Continue-wait polling, status transitions, timeouts
- `server/src/jobs/cron-runner.ts` — cron scheduling
- `server/src/db/migrations/003-card-cache.sql` — `segment_card_cache` schema as template
- `server/src/db/migrations/005-refresh-log.sql` — `segment_refresh_log` as template
- `src/pages/Liveops/use-live-kpis.ts` — already has sessionStorage cache; will switch to read from server cache
- `src/pages/Dashboards/tile-fetch-queue.ts` — throttled queue; complements the new server cache

## Unresolved questions

1. **Cache freshness contract per surface:** KPI strip wants ≤60s lag, cohort grid tolerates 30min, funnel ~15min. Per-resource TTL or one universal value?
2. **On-demand refresh vs only cron:** add a "Refresh now" button per surface? (low effort, high user trust)
3. **Cache scope:** per-game shared (no PII) is fine for liveops/dashboards. Confirm before shipping.
4. **Cache invalidation on schema changes:** when a Cube measure name changes or a YAML redeploys, stored `rows_json` may be wrong-shaped. Add `cube_meta_version` column + bust on mismatch?
5. **Huashu-design output medium:** Phase 1 — Tailwind+CSS rewrite OR wholesale antd → tokenized refactor? Cost differs by 3×.
