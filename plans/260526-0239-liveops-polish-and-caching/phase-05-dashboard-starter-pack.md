---
phase: 5
title: "Dashboard starter pack"
status: pending
priority: P1
effort: "2d"
dependencies: [3]
---

# Phase 5: Dashboard starter pack

## Overview

Turn the dashboard feature from "blank canvas" into "instant value." Three coupled changes:
1. **4 persona-scoped starter dashboards** seeded per game on first visit
2. **Compare-toggle pre-baked into pinned tiles** so each tile reads "current vs prior"
3. **First-visit seeding mechanism** that idempotently installs the starter pack

Goal: an analyst lands on `/dashboards` for `cfm` and immediately sees 4 useful dashboards filled with live data — no manual pinning required.

## Why

Phase 3 of the original pack shipped the dashboard infrastructure. Anyone who opens it sees an empty list, has to click "New dashboard", run a query, pin it. That's 5+ steps before any value. With this phase, the value is one click away.

This also tells a strong product story: dashboards aren't just an empty container, they're a curated set of views the team can extend.

## Requirements

**Functional**

### 5.1 — Starter dashboard definitions
Four dashboards per game (slugs unique per game), each with 3–5 tiles:

| Slug | Title | Tiles |
|---|---|---|
| `daily-health` | Daily health (morning standup) | DAU, MAU, Revenue, Paying users, ARPDAU — all with `compare=prev` |
| `monetization` | Monetization | Paying users (line, 30d), ARPDAU (line, 30d), Revenue (bar, by day), Paying conversion (computed) |
| `retention-deep-dive` | Retention deep-dive | D1 retention sparkline, D7 sparkline, D30 sparkline, mini cohort grid (last 14 cohorts), payer retention curve |
| `anomaly-triage` | Anomaly triage | Open anomalies count (KPI), top-5 severities (bar list), per-metric open-count breakdown, link to inbox |

Tile definitions live in `server/src/presets/dashboard-starter-pack/` as YAML mirroring the existing `business-metrics/*.yml` pattern. Per-game overrides allowed (e.g. muaw/ptg skip retention-deep-dive because they lack `active_daily`).

### 5.2 — Pre-baked compare in tiles
- `dashboard_tiles.query_json` accepts an embedded `compare: 'prev' | { game: '<id>' } | null` field (extension to existing tile shape).
- When `compare` is set, the tile renderer wraps its load through `useCompareResults` (already shipped) and renders Current / Δ / Δ% inline. Server cache key includes the compare mode so we don't double-key the same query.
- Pin-to-dashboard modal grows a "Include comparison" checkbox: defaults ON for time-series measures (DAU/MAU/Revenue), OFF for stateful counts (open anomalies).

### 5.3 — First-visit seeding
- On `GET /api/dashboards?game=<id>`: if zero dashboards exist for that `(owner, game)` pair, the server returns the response **then** asynchronously runs `seedStarterPack(owner, game)` which idempotently installs the 4 starters.
- The next refetch (frontend re-polls 1s later) sees them populated.
- Seeding is idempotent: checks `(owner, game, slug)` UNIQUE constraint before inserting. Re-running is a no-op.
- A "Reset to starter pack" button on `/dashboards` settings (small kebab menu) re-runs the seeder, only inserting starters that don't exist.

**Non-functional**
- Seeded tiles must use measure references that exist in the active game's meta. Skip tiles whose required cubes are absent (e.g. retention-deep-dive on muaw/ptg).
- Seeding completes in < 500ms (insert 4 dashboards × ≤5 tiles each = ~24 sqlite inserts, trivial).
- Starter YAML files validated at server boot — invalid file fails fast with a clear error.

## Architecture

```
server/src/presets/dashboard-starter-pack/
  daily-health.yml
  monetization.yml
  retention-deep-dive.yml
  anomaly-triage.yml

server/src/services/dashboard-starter-pack-loader.ts  -- read YAMLs, validate
server/src/services/dashboard-starter-pack-seeder.ts  -- idempotent installer
                                                         takes (owner, game, meta) → inserts dashboards + tiles
server/src/routes/dashboards.ts                       -- extend GET list with auto-seed trigger
```

YAML shape:
```yaml
slug: daily-health
title: Daily health (morning standup)
description: The morning standup view — DAU, MAU, Revenue, Paying users, ARPDAU.
applies_when:
  required_cubes: [active_daily, user_recharge_daily]   # skip game if absent
tiles:
  - title: DAU
    viz_type: kpi
    position: { x: 0, y: 0, w: 3, h: 2 }
    query:
      measures: [active_daily.dau]
      timeDimensions: [{ dimension: active_daily.log_date, granularity: day, dateRange: last 14 days }]
      compare: prev
  # …4 more tiles
```

### Frontend changes
- `src/pages/Dashboards/index.tsx` — if list is empty AND no recent seed attempt, show "Setting up starter dashboards…" skeleton; re-poll once.
- `src/pages/Dashboards/dashboard-detail.tsx` — render compare columns on tiles where `tile.query.compare` is set (reuse Phase 4 compare renderer from the original pack).
- `src/pages/Dashboards/pin-to-dashboard-modal.tsx` — add "Include comparison" checkbox; auto-default based on heuristic (time-series measure → ON).
- Small `<StarterPackBanner>` on `/dashboards` for ~7 days post-seed: "These were seeded automatically. Edit or delete anything." Dismissible.

## Related Code Files

- **Create**
  - `server/src/presets/dashboard-starter-pack/daily-health.yml`
  - `server/src/presets/dashboard-starter-pack/monetization.yml`
  - `server/src/presets/dashboard-starter-pack/retention-deep-dive.yml`
  - `server/src/presets/dashboard-starter-pack/anomaly-triage.yml`
  - `server/src/services/dashboard-starter-pack-loader.ts`
  - `server/src/services/dashboard-starter-pack-seeder.ts`
  - `server/test/dashboard-starter-pack-seeder.test.ts`
  - `src/pages/Dashboards/starter-pack-banner.tsx` (+ test)
- **Modify**
  - `server/src/routes/dashboards.ts` — auto-seed on empty list; `POST /api/dashboards/reset-starter-pack`
  - `server/src/services/dashboard-store.ts` — query JSON now accepts optional `compare` field (type extension only; viz layer reads it)
  - `src/pages/Dashboards/index.tsx` — empty-state polling + banner mount
  - `src/pages/Dashboards/dashboard-detail.tsx` — render compare columns on starter tiles
  - `src/pages/Dashboards/pin-to-dashboard-modal.tsx` — "Include comparison" checkbox
  - `src/api/dashboards-client.ts` — add `resetStarterPack(game)` helper

## Implementation Steps

1. Author the 4 YAML files. Measure names verified against `cube-dev/cube/model/cubes/<game>/*.yml` — only use measures that exist.
2. `dashboard-starter-pack-loader.ts` — read + Zod-validate at boot.
3. `dashboard-starter-pack-seeder.ts` — pure fn `(owner, game, meta) → { dashboards: [], tiles: [] }`; idempotent inserts.
4. Wire into `routes/dashboards.ts` — empty-list response triggers `seedStarterPack` via `setImmediate` (don't block the response).
5. Frontend: empty-state skeleton + 1s re-poll once. Banner.
6. Pin modal: "Include comparison" checkbox + heuristic default.
7. Tile renderer: read `tile.query.compare`, dispatch to Phase 4 compare renderer.
8. Reset-to-starter-pack action: tiny endpoint + button.
9. Tests:
   - Seeder idempotency (run twice → same row count).
   - Skip-when-cubes-absent (seed muaw → no retention-deep-dive).
   - Compare-in-tile rendering (mounted tile with `compare: 'prev'` renders 4 columns).
   - YAML validation fails fast on malformed input.

## Success Criteria

- [ ] Open `/dashboards` on a fresh game → 4 starter dashboards appear within 2s.
- [ ] Each starter dashboard loads its tiles from cache (Phase 3) — zero browser Cube calls.
- [ ] `daily-health` tiles show Current / Δ / Δ% columns out of the box.
- [ ] muaw + ptg get only 2 of 4 starters (skip retention-deep-dive + maybe monetization depending on cube availability).
- [ ] Re-seeding is a no-op (verify with row counts).
- [ ] "Reset to starter pack" restores deleted starter dashboards but doesn't touch user-created ones.
- [ ] Pinning a query from the playground shows "Include comparison" checkbox with sensible default.

## Risk Assessment

- **Risk:** seeded tiles reference a measure that doesn't exist for some game → broken tile on first open.
  **Mitigation:** `applies_when.required_cubes` gates per-dashboard inclusion. Loader validates measure refs against current meta at seed time, skips broken tiles with a warn log.
- **Risk:** users delete the starter pack then complain it's gone.
  **Mitigation:** "Reset to starter pack" button + banner explaining what was seeded. Don't auto-reseed silently.
- **Risk:** compare-in-tile doubles cache key cardinality.
  **Mitigation:** measured impact small — same query just runs with shifted dateRange. Phase 3's cache handles both transparently.
- **Risk:** YAML drift as measure names change in cube-dev.
  **Mitigation:** loader runs at boot; mismatched refs surface in logs immediately, not at runtime when an analyst clicks. Add CI check in a follow-up.
