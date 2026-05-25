---
phase: 2
title: "Anomaly inbox"
status: completed
priority: P1
effort: "2-3d"
dependencies: [1]
---

# Phase 2: Anomaly inbox

## Overview

Finish the half-built anomaly system. Server: detector job rolls z-score (MAD optional) over last 14d on a configured set of measures per game, persists anomaly records to sqlite. Frontend: triage inbox at `/liveops/anomalies` showing severity-sorted rows with ack / snooze / open-in-playground actions. Deep-link to playground uses the existing query-string contract.

## Requirements

**Functional**
- Per-game rolling z-score (default) or MAD detector over the last 14 daily points of each watched measure.
- Anomaly record: `{ id, game, metric, severity, baseline, observed, ts, status: 'open'|'ack'|'snoozed', snoozeUntil?, createdAt, updatedAt }`.
- Severity ladder: `low` |z| ≥ 2, `med` ≥ 3, `high` ≥ 4 (configurable in `anomaly-config.ts`).
- API surface:
  - `GET /api/anomalies?game=<id>&status=open` — list (existing `GET /api/anomaly-state` extended).
  - `POST /api/anomalies/:id/ack` — mark ack.
  - `POST /api/anomalies/:id/snooze` — `{ until: ISO8601 }`.
- Detector runs in-process, `setInterval` every 15min, keyed by game from `games-config-loader.ts`.
- Frontend surfaces (all four):
  1. **`/liveops/anomalies` triage inbox** — rows sorted by severity desc, then ts desc. Ack / snooze / open-in-playground per row. Optimistic update + rollback.
  2. **Topbar bell** — global icon in the existing topbar (next to `NotificationBell` slot — see `docs/codebase-summary.md` topbar section). Shows count of open anomalies for active game (`med`+ only). Click → opens inbox.
  3. **Red dot on KPI hero tile (Phase 1 coupling)** — each `<KpiTile>` in the hero strip checks if its `metric` matches an open anomaly. If yes, render a small severity-colored dot in the tile corner. Click → opens inbox pre-filtered to that metric (`/liveops/anomalies?metric=…`).
  4. **Inline strip on `/liveops` top** — 1-line banner above the KPI hero strip when ≥1 `high`-severity anomaly is open: "🔴 2 high-severity anomalies — review". Click → inbox. Hidden when zero high-severity open.

  All four read from the same `useAnomalies(gameId)` hook (shared cache, single source of truth — DRY).

**Non-functional**
- Detector tick must not block HTTP handlers (run in `setImmediate` + concurrency cap = 1 per game).
- Sqlite write batched per tick (single transaction).
- Frontend list virtualizes after 50 rows (use `react-window` if not already present; otherwise paginate).

## Architecture

```
Detector loop (server, every 15min):
  for each game in gamesConfig:
    for each watched measure in anomaly-config[game]:
      series = cube.load(measure, last 14d daily)
      stat = zScore(series)  ← server/src/services/z-score.ts
      if |stat.latestZ| >= threshold:
        upsertAnomaly({ game, metric, severity, baseline, observed, ts })

Storage (sqlite, migration 00X — id assigned after Phase 3 dashboards picks 009):
  anomalies (
    id INTEGER PK,
    game TEXT NOT NULL,
    metric TEXT NOT NULL,
    severity TEXT CHECK(severity IN ('low','med','high')) NOT NULL,
    baseline REAL NOT NULL,
    observed REAL NOT NULL,
    ts TEXT NOT NULL,           -- ISO8601 of anomalous point
    status TEXT CHECK(status IN ('open','ack','snoozed')) NOT NULL DEFAULT 'open',
    snooze_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(game, metric, ts)    -- idempotent per data point
  );
  CREATE INDEX anomalies_game_status ON anomalies(game, status);

Frontend:
  /liveops/anomalies → <AnomalyInbox>
    useAnomalies(gameId, status='open') — SWR-style polling 60s
    <AnomalyRow> per record + <RowActions>
```

`anomaly-state-store.ts` already exists — extend (don't duplicate) for persistence + status transitions.

## Related Code Files

- **Create**
  - `server/src/db/migrations/00X-anomalies.sql` (id assigned after Phase 3 lands)
  - `server/src/jobs/anomaly-detector.ts` — interval loop
  - `server/src/services/anomaly-config.ts` — per-game watched metrics + thresholds
  - `src/pages/Liveops/anomaly-inbox/index.tsx`
  - `src/pages/Liveops/anomaly-inbox/anomaly-row.tsx`
  - `src/pages/Liveops/anomaly-inbox/use-anomalies.ts` — shared SWR-style hook, consumed by all 4 surfaces
  - `src/pages/Liveops/anomaly-inbox/open-in-playground.ts` — query-string builder
  - `src/shell/anomaly-bell.tsx` — topbar bell (Surface 2)
  - `src/pages/Liveops/anomaly-tile-badge.tsx` — small dot overlay for `<KpiTile>` (Surface 3)
  - `src/pages/Liveops/anomaly-high-severity-strip.tsx` — inline banner (Surface 4)
- **Modify**
  - `server/src/routes/anomaly-state.ts` — add list/ack/snooze handlers (or split into `anomalies.ts` and 301 old route)
  - `server/src/services/anomaly-state-store.ts` — persistence + status methods
  - `server/src/index.ts` — register detector job on startup
  - `src/App.tsx` — add `/liveops/anomalies` route + LiveopsPage tab; accept `?metric=…` filter
  - `src/shell/<topbar>.tsx` — mount `<AnomalyBell>` (Surface 2; topbar location per `docs/codebase-summary.md` topbar IA)
  - `src/pages/Liveops/kpi-hero-strip.tsx` (Phase 1 file) — render `<AnomalyTileBadge>` over each `<KpiTile>` (Surface 3)
  - `src/pages/Liveops/index.tsx` (Phase 1 file) — render `<AnomalyHighSeverityStrip>` above hero strip (Surface 4)
- **Reuse (no edit)**
  - `server/src/services/z-score.ts`
  - `server/src/services/cube-client.ts`
  - `server/src/services/games-config-loader.ts`

## Implementation Steps

1. Write migration adding `anomalies` table; bump migration runner.
2. Extend `anomaly-state-store.ts` with `upsert`, `listOpen`, `setStatus` methods (parameterized sqlite).
3. Add `anomaly-config.ts` — `{ [game]: { metric: string, timeDim: string, threshold: { low, med, high } }[] }`.
4. Build `anomaly-detector.ts`: on tick, for each (game, metric) pull series, compute z, upsert if exceeds threshold. Concurrency cap via in-memory mutex.
5. Wire detector start in `server/src/index.ts` (env flag `ANOMALY_DETECTOR_ENABLED=true` to avoid noisy local dev).
6. Replace single `GET /api/anomaly-state` with proper REST: `GET /api/anomalies`, `POST /api/anomalies/:id/ack`, `POST /api/anomalies/:id/snooze`. Keep old endpoint as deprecation shim if referenced.
7. Frontend: `use-anomalies.ts` polls list every 60s; `<AnomalyInbox>` renders sorted rows.
8. `<RowActions>`: ack/snooze with optimistic update + toast. Snooze popover with 1h / 4h / 24h presets.
9. `open-in-playground.ts`: build URL with `query` param from `{ measure, timeDimensions, dateRange: 14d centered on anomaly ts }`. Reuse existing playground deep-link format.
10. Tests: detector picks up synthetic spike; ack transitions status; snoozed rows hidden from open list.

## Success Criteria

- [ ] Detector populates `anomalies` table after 1 tick when a synthetic spike is injected.
- [ ] `GET /api/anomalies?game=cfm&status=open` returns rows sorted by severity.
- [ ] Ack + snooze update status; snoozed rows disappear from open list, reappear after `snoozeUntil`.
- [ ] "Open in playground" loads playground with metric + dateRange pre-seeded.
- [ ] No detector calls during HTTP request lifecycle (interval-driven only).
- [ ] Migration is reversible (down script noted in plan comment if not in schema).
- [ ] **Surface 1:** `/liveops/anomalies` renders inbox; `?metric=…` filters list.
- [ ] **Surface 2:** Topbar bell shows count of open `med`+ anomalies for active game; click navigates to inbox.
- [ ] **Surface 3:** KPI hero tiles show a severity-colored dot when their metric has an open anomaly; click navigates to inbox filtered to that metric.
- [ ] **Surface 4:** `/liveops` shows a high-severity strip only when ≥1 `high` anomaly is open; hidden otherwise.
- [ ] All 4 surfaces share a single `useAnomalies(gameId)` cache (verify via React DevTools — only one network request).

## Risk Assessment

- **Risk:** noisy alerts at low threshold scare users.
  **Mitigation:** ship with `low=disabled` by default; only `med`+ surface in UI. Threshold knobs in `anomaly-config.ts`.
- **Risk:** detector runs N×M Cube queries per tick — may spike load.
  **Mitigation:** per-tick query budget cap (e.g. 20); skip remainder with warn log; preaggregations absorb load in prod.
- **Risk:** z-score breaks on series with <3 points or zero variance.
  **Mitigation:** `z-score.ts` already guards these — assert + extend tests.
- **Risk:** multi-replica detector double-fires.
  **Mitigation:** single-process acceptable for demo; document constraint. Production hardening = lease row or external scheduler (out of scope).
