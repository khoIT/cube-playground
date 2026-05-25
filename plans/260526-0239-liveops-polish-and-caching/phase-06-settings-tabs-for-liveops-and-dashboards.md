---
phase: 6
title: "Settings tabs for Liveops and Dashboards"
status: pending
priority: P2
effort: "1d"
dependencies: [2, 3, 5]
---

# Phase 6: Settings tabs for Liveops and Dashboards

## Overview

Two new tabs on the existing `/settings` page — **Liveops** and **Dashboards** — exposing the configuration knobs introduced by Phases 2–5. Reuses the vertical-rail layout in `src/pages/Settings/settings-tabs.tsx` (already supports adding tabs).

## Why

Phases 2–5 introduce real knobs:
- KPI strip refresh interval (currently hardcoded 45s)
- Anomaly detector enabled / per-metric thresholds
- Liveops cache TTL per resource
- Dashboard tile TTL per dashboard
- "Refresh horizon" — how many days of `last_viewed_at` count as active
- Starter pack reset action

Today these live in env vars + ts constants. Putting them behind UI lets ops self-tune without code changes and makes the demo feel real ("look, you can tweak this").

## Requirements

**Functional**

### Liveops tab (`/settings#liveops`)
- **KPI strip refresh** — slider 15s → 5min (default 45s). Stored in `app_settings` table or localStorage; hook reads on mount.
- **Anomaly detector** — toggle (on/off) backed by `ANOMALY_DETECTOR_ENABLED` (now reads from DB at server boot + on demand).
- **Anomaly thresholds** — per-severity sliders (`low` |z|≥2, `med` ≥3, `high` ≥4). Edit per-game, with a "use defaults" reset.
- **Anomaly watched metrics** — checklist of available measures per game; toggle metrics on/off without editing code.
- **Liveops cache TTL** — per-resource (kpi_strip / cohort_grid / funnel_result) numeric inputs.

### Dashboards tab (`/settings#dashboards`)
- **Default tile TTL** — applies to newly created dashboards. Per-dashboard overrides remain editable in dashboard settings.
- **Refresh horizon (days)** — how many days `last_viewed_at` qualifies a dashboard as "active". Default 7.
- **Tile fetch concurrency** — max parallel Cube `/load`s the refresh job will issue per tick (default 30).
- **Starter pack actions:**
  - "Re-seed starter pack for this game" button (calls `POST /api/dashboards/reset-starter-pack`)
  - Status: shows count of currently-installed starter dashboards (out of 4 expected for the active game).

**Non-functional**
- Settings persist in sqlite — new `app_settings` table (single-row pattern) or extension of an existing config table.
- Server-side validation on PATCH: clamp values to safe ranges (TTL ≥ 30s, refresh-horizon 1–90 days, etc.).
- Changes apply immediately for read paths; cron-tick-bound settings (TTL changes) take effect on next tick.
- No new deps.

## Architecture

### Schema — migration 014-app-settings.sql

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,                -- JSON
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Seed defaults
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('liveops.kpi_refresh_seconds',      '45'),
  ('liveops.cache_ttl_seconds',        '{"kpi_strip":60,"cohort_grid":1800,"funnel_result":900}'),
  ('liveops.anomaly_detector_enabled', 'true'),
  ('liveops.anomaly_thresholds',       '{"low":2,"med":3,"high":4}'),
  ('dashboards.tile_ttl_seconds',      '300'),
  ('dashboards.refresh_horizon_days',  '7'),
  ('dashboards.refresh_concurrency',   '30');
```

### API

```
GET  /api/settings              → all settings as { [key]: jsonValue }
PATCH /api/settings             → body { key, value }; clamps + validates
POST /api/dashboards/reset-starter-pack?game=<id>   (already from Phase 5)
```

### Frontend layout

`src/pages/Settings/settings-page.tsx` is already set up as a tab dispatcher. Add two descriptors to the `tabs` array and two new section components:
- `<LiveopsSettingsSection />`
- `<DashboardsSettingsSection />`

Each section is its own file under `src/pages/Settings/`. Use the existing `<SectionCard>` primitive for consistent chrome. Backed by a small `useAppSettings()` hook that reads/writes via the new endpoints.

### Consumer reads (small wiring)

- `src/pages/Liveops/use-live-kpis.ts` — read `liveops.kpi_refresh_seconds` instead of constant.
- `server/src/jobs/refresh-liveops.ts` (Phase 2) — read TTLs from `app_settings` on each tick (cheap; in-memory cache invalidated on PATCH).
- `server/src/jobs/anomaly-detector.ts` — read enabled flag + thresholds.
- `server/src/jobs/refresh-dashboard-tiles.ts` (Phase 3) — read `refresh_horizon_days` + `tile_ttl_seconds` + `refresh_concurrency`.

A small `app-settings-store.ts` service with in-memory cache + 30s-or-on-write invalidation keeps perf trivial.

## Related Code Files

- **Create**
  - `server/src/db/migrations/014-app-settings.sql`
  - `server/src/services/app-settings-store.ts`
  - `server/src/routes/settings.ts`
  - `src/pages/Settings/liveops-settings-section.tsx`
  - `src/pages/Settings/dashboards-settings-section.tsx`
  - `src/pages/Settings/use-app-settings.ts`
  - Tests for store + sections
- **Modify**
  - `server/src/index.ts` — register settings routes
  - `src/pages/Settings/settings-page.tsx` — add 2 tab descriptors (use lucide `Activity` / `LayoutGrid` icons)
  - `src/pages/Liveops/use-live-kpis.ts` — read refresh interval from settings
  - `server/src/jobs/refresh-liveops.ts` — read TTLs from settings
  - `server/src/jobs/anomaly-detector.ts` — read enabled + thresholds
  - `server/src/jobs/refresh-dashboard-tiles.ts` — read horizon + concurrency

## Implementation Steps

1. Migration 014 + seeded defaults.
2. `app-settings-store.ts` — get/set + in-memory cache. Validation per key.
3. `routes/settings.ts` — `GET /api/settings`, `PATCH /api/settings`.
4. `use-app-settings.ts` — hook with SWR-style polling (60s).
5. Liveops section — 5 control rows (refresh slider, detector toggle, thresholds, watched-metrics checklist, cache TTLs).
6. Dashboards section — 4 control rows + starter-pack status + reset button.
7. Wire `settings-page.tsx` tabs.
8. Update consumer files (4 server jobs + 1 frontend hook) to read from settings.
9. Tests: PATCH validation, sections render + interact, consumer reads on change.

## Success Criteria

- [ ] `/settings#liveops` shows all 5 Liveops controls; editing them PATCHes settings.
- [ ] `/settings#dashboards` shows all 4 Dashboards controls + starter pack status.
- [ ] Changing KPI refresh interval → next `useLiveKpis` mount uses new value.
- [ ] Changing anomaly detector toggle → detector pauses on next tick (verify via log).
- [ ] Changing dashboard refresh horizon → cron tick uses new value (verify via log of "considered N dashboards").
- [ ] Starter-pack reset button installs missing starters; status indicator updates.
- [ ] No new deps.
- [ ] All existing settings-page tests pass.

## Risk Assessment

- **Risk:** sliders with bad values (TTL = 1s) wreck Trino with constant queries.
  **Mitigation:** server-side clamps. Min TTL 30s, max refresh-concurrency 100, etc.
- **Risk:** drift between env-var defaults and DB-seeded defaults.
  **Mitigation:** migration seeds run only if rows absent (`INSERT OR IGNORE`); env vars deprecated with a log warning on boot if they're set.
- **Risk:** consumer code reads stale in-memory settings after a PATCH.
  **Mitigation:** PATCH bumps an in-memory version; readers check version before serving from cache. Tested explicitly.
- **Risk:** UI scope creeps to "expose every config" (segment refresh cadence, chat-service knobs, etc.).
  **Mitigation:** this phase is strictly Liveops + Dashboards. Other settings = separate phase.
