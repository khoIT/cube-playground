---
phase: 2
title: "Liveops result cache"
status: pending
priority: P1
effort: "2-3d"
dependencies: []
---

# Phase 2: Liveops result cache

## Overview

Server-side result cache for KPI strip, cohort grid, and funnel — mirrors the Segments `segment_card_cache` + `refresh-segment.ts` pattern. Frontend reads cached rows from sqlite; cron job refreshes per resource on a TTL. Eliminates the per-page-open burst of Cube/Trino queries.

## Why

- **Today:** `/liveops` open issues 5 parallel Cube `/load` calls. Cohort fetches up to 50k rows. Funnel runs a UNION across 4 etl tables. Each request goes to Trino.
- **Goal:** frontend reads from sqlite in <50ms; Trino is hit only by the cron job at the TTL cadence.
- **Inspiration:** `server/src/services/card-cache-store.ts` + `server/src/jobs/refresh-segment.ts` already do this for Segments. Hash-skip writes keep the snapshot stable.

## Requirements

**Functional**
- Three cached resources, each independently refreshable + invalidatable:
  - `kpi_strip` — keyed by `(game, kpi_id)`; payload = `{ value, delta, sparkline[] }`
  - `cohort_grid` — keyed by `(game, window_days)`; payload = `{ rows: CohortRow[] }`
  - `funnel_result` — keyed by `(game, funnel_def_hash)`; payload = `{ steps: FunnelStep[] }`
- Per-resource TTL (configurable in `liveops-cache-config.ts`):
  - `kpi_strip` — 60s (matches frontend's 45s refresh + buffer)
  - `cohort_grid` — 30 min
  - `funnel_result` — 15 min
- API:
  - `GET /api/liveops/kpi-strip?game=<id>` → cached payload + `fetched_at`
  - `GET /api/liveops/cohort?game=<id>&window=<days>` → cached payload + `fetched_at`
  - `POST /api/liveops/funnel` body `{ game, funnelDef }` → cached payload + `fetched_at`
  - `POST /api/liveops/refresh?resource=<kpi|cohort|funnel>&key=<game>` → force refresh now (manual button)
- Cron job runs every 60s; checks `expires_at` and refreshes stale rows for active games.
- Continue-wait polling reused from `refresh-segment.ts` (Cube pre-agg warming).

**Non-functional**
- All writes use the `card-cache-store` hash-skip pattern (no-op if rows unchanged → quiet snapshot diffs).
- Cron job query budget: max 30 Cube `/load`s per tick across all resources.
- Read path bypasses Cube entirely; on cache miss, returns 202 + triggers async fill (not 500).
- Stored payloads are versioned: row holds `cube_meta_version` (hash of relevant cubes' shape). On read, mismatch returns 202 + triggers re-fill.

## Architecture

### Schema — migration 012-liveops-cache.sql

```sql
CREATE TABLE IF NOT EXISTS liveops_result_cache (
  resource          TEXT NOT NULL,           -- 'kpi_strip' | 'cohort_grid' | 'funnel_result'
  cache_key         TEXT NOT NULL,           -- canonical key: e.g. "cfm:14" or "cfm:<funnelHash>"
  game              TEXT NOT NULL,           -- for cron iteration
  payload_json      TEXT NOT NULL,
  payload_hash      TEXT NOT NULL,           -- sha256(payload) prefix
  cube_meta_version TEXT NOT NULL,           -- bust-on-schema-change
  fetched_at        DATETIME NOT NULL DEFAULT (datetime('now')),
  expires_at        DATETIME NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('fresh','refreshing','broken')) DEFAULT 'fresh',
  error_msg         TEXT,
  PRIMARY KEY (resource, cache_key)
);
CREATE INDEX IF NOT EXISTS idx_liveops_cache_expires ON liveops_result_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_liveops_cache_game    ON liveops_result_cache(game, resource);

CREATE TABLE IF NOT EXISTS liveops_refresh_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  resource    TEXT NOT NULL,
  cache_key   TEXT NOT NULL,
  game        TEXT NOT NULL,
  ts          DATETIME NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER NOT NULL,
  status      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_liveops_refresh_log_ts ON liveops_refresh_log(ts DESC);
```

### Service layout

```
server/src/services/liveops-cache-store.ts    -- upsert/read/invalidate (mirrors card-cache-store.ts)
server/src/services/liveops-cache-config.ts   -- TTLs per resource + cron interval
server/src/services/cube-meta-version.ts      -- hash of meta.cubes shape for active game
server/src/jobs/refresh-liveops.ts            -- cron, mirrors refresh-segment.ts pattern
server/src/routes/liveops.ts                  -- new HTTP surface (GET/POST endpoints above)
```

### Refresh job flow

```
every 60s:
  for each active game (from games-config-loader):
    for each stale resource (expires_at < now):
      mark status='refreshing'
      try:
        run the appropriate Cube load(s) with Continue-wait polling
        compute payload + payload_hash + cube_meta_version
        upsert (skip if payload_hash unchanged)
        log to liveops_refresh_log with duration + 'ok'
        mark status='fresh', expires_at=now+ttl
      catch:
        mark status='broken', error_msg=truncate(err)
        log status='broken'
        next resource (do not stop the whole tick)
```

### Frontend hook updates (small)

- `src/pages/Liveops/use-live-kpis.ts` — switch HTTP target from `cubejsApi.load` to `GET /api/liveops/kpi-strip`. SessionStorage cache stays as L1 (sub-second flicker between routes).
- `src/pages/Liveops/cohort/use-cohort-grid.ts` — `GET /api/liveops/cohort`. Path A detection moves to server (server checks meta + picks single-query SQL OR computes pivot client-side and stores the pivoted result).
- `src/pages/Segments/funnel-builder/run-funnel.ts` — POST to `/api/liveops/funnel`. Server resolves identical funnel defs to the same `cache_key` via canonical-JSON hash.

## Related Code Files

- **Create**
  - `server/src/db/migrations/012-liveops-cache.sql`
  - `server/src/services/liveops-cache-store.ts`
  - `server/src/services/liveops-cache-config.ts`
  - `server/src/services/cube-meta-version.ts`
  - `server/src/jobs/refresh-liveops.ts`
  - `server/src/routes/liveops.ts`
  - Tests for all of the above + integration test for cron + invalidate-on-schema-change
- **Modify**
  - `server/src/index.ts` — register routes + start refresh-liveops cron
  - `server/src/jobs/cron-runner.ts` — register the new job
  - `src/pages/Liveops/use-live-kpis.ts` — switch read source
  - `src/pages/Liveops/cohort/use-cohort-grid.ts` — switch read source
  - `src/pages/Segments/funnel-builder/run-funnel.ts` — switch dispatcher to API
  - `src/api/` — add typed client for the new endpoints

## Implementation Steps

1. Migration 012 + run runner.
2. `liveops-cache-store.ts`: prepared statements for upsert (hash-skip), read, invalidate-by-game, list-stale.
3. `cube-meta-version.ts`: hash relevant cubes' member list per game. Reuse `meta-cache.ts`.
4. `liveops-cache-config.ts`: TTL map + active-resources list.
5. `refresh-liveops.ts`: the loop. Per-resource handler functions (small + pure-ish). Continue-wait helper extracted from `refresh-segment.ts` into a shared util if not already shared.
6. `routes/liveops.ts`: 4 endpoints. Cache miss path → 202 + best-effort sync-or-defer.
7. Wire into `cron-runner.ts` + `server/src/index.ts`.
8. Frontend hooks: small surgical changes. Existing sessionStorage L1 cache stays.
9. Tests:
   - Store: upsert idempotency, expires_at logic, meta-version bust.
   - Job: stale row picked up; broken-status path; budget cap.
   - Routes: cache hit < 50ms; cache miss → 202.
   - E2E: invalidate when meta hash changes.

## Success Criteria

- [ ] `/liveops` open issues ≤ 1 HTTP call to `/api/liveops/*` and zero Cube `/load` from browser.
- [ ] `GET /api/liveops/kpi-strip?game=cfm` cache hit serves in < 50ms (verify with perf log).
- [ ] Cron tick refreshes stale rows; `liveops_refresh_log` rows visible.
- [ ] Manual `POST /api/liveops/refresh` forces refresh; UI tile shows updated `fetched_at`.
- [ ] Hash-skip writes — re-running cron with unchanged data must not bump `fetched_at`. (verify in test)
- [ ] Schema-change bust — change a watched cube's measure → next read returns 202 + re-fills.
- [ ] No regression in Phase 1-2 frontend tests.

## Risk Assessment

- **Risk:** sqlite write contention with the chat-service / segments cron.
  **Mitigation:** WAL mode is already enabled (verify in `db/sqlite.ts`); refresh logic uses small, fast transactions.
- **Risk:** cache misses on first-ever request for a game return 202 — frontend must handle gracefully.
  **Mitigation:** hook treats 202 as "loading, retry in 2s with exponential backoff capped at 10s". UX = skeleton + "warming up" badge.
- **Risk:** stale data shown when a real anomaly occurs in the last 60s.
  **Mitigation:** TTL of 60s on KPI is the explicit trade. Anomaly inbox keeps its own 60s polling (it's already cached in the anomalies table, not Cube).
- **Risk:** funnel cache keyed by funnel-def hash → infinite cache growth as analysts experiment.
  **Mitigation:** retention sweep — drop funnel cache rows with `fetched_at < now - 14d`. Add to `cron-runner.ts`.
