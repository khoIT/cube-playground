# Metric ↔ Cube Coverage Monitor + Scaffolding

**Date**: 2026-05-27 13:44
**Severity**: Low (additive; new Settings surface + read/write API)
**Component**: business-metrics registry ↔ cube-dev model reconciliation
**Status**: Resolved — server 295 / web 1441 green; endpoints live-verified on :3000

## Context

Started from anomaly-detector log spam (`/load 400: 'trailing_wau' not found for path 'mf_users.trailing_wau'`). Root cause: the curated business-metrics registry (`server/src/presets/business-metrics/*.yml`) points `formula.ref` at cube measures, but many refs targeted `mf_users` for measures that cube `/meta` never exposed. Earlier commits fixed the concrete metrics (WAU/trailing → `active_daily`/`user_recharge_daily`; retention rates → `retention`) and hardened the detector to skip unresolved refs. This session productized the *detection* into a monitoring + scaffolding surface.

## What Shipped

1. **Coverage resolver** — `metric-coverage-resolver.ts`: per game, computes broken refs (delegates to `validateRefs`), uncovered measures (`/meta` measures referenced by no metric), and a metric×game matrix. Fail-open per game (`status:'error'`). Extended `MetaSnapshot` with a `measures` set (was merged into `members`) so uncovered detection ignores dimensions.
2. **Stub scaffolder** — `metric-stub-scaffolder.ts`: pure `ref → trust:draft BusinessMetric`. Infers `domain` from ref keywords (the enum has no generic bucket), slugifies id with collision suffix, Zod-validates so output flows straight through the existing atomic `writeMetric`.
3. **API** — `GET /api/business-metrics/coverage` (all games or `?game=`), `POST /api/business-metrics/scaffold` (idempotent — skips refs already covered or id clashes; reuses the audit path).
4. **Settings → Metric coverage tab** — `metric-coverage-section.tsx` + `coverage-ui.tsx` (Collapsible + GameFilterChips) + `metric-coverage-matrix.tsx` + `use-metric-coverage.ts`. Game-filter chips scope all three views; sections collapse; uncovered list multiselect → "Scaffold drafts".
5. **Tests** — 4 backend suites (resolver, scaffolder, coverage + scaffold endpoints) + 1 RTL section test.

## Decisions / Lessons

- **Two sources of truth, not one.** Matrix rows = curated registry; uncovered list = cube-dev `/meta`. The panel surfaces the *delta* both directions. Resisted auto-generating curated metrics — scaffolding yields `trust:draft` stubs for human curation, never blind copy or auto-repoint.
- **"Empty selection = all games"** beats seeding the filter via `useEffect`: the effect raced each `Collapsible`'s `defaultOpen` initializer (sections mounted before the seed landed, so they stuck closed). Deriving active games from an empty set also handles the async report load cleanly.
- **The drift is concentrated, not scattered.** Of 81 registry refs, 50 broke — but 47 targeted `mf_users` (a per-user profile cube, only 5 resolve) and 8 used the stale cube name `funnel` (real: `ordered_event_funnel`). Cubes referenced correctly resolve ~100% (recharge 9/9, retention 8/8, active_daily 7/7). So it's ~2 systemic mis-authorings + 21 measures awaiting cubes — not 50 independent gaps.

## Unresolved / Follow-ups

- Buckets B/C/D still open: build a cube over `cons_game_key_metrics_daily` (marketing/new-paying — ~23 metrics), a roles cube (`std_ingame_role_*`), funnel measures on `ordered_event_funnel`. Concurrency (`acu/ccu/lcu/pcu`) has no source table.
- `funnel` rename (8 refs → `ordered_event_funnel`) is a quick win not yet done.
- Optional: a cube-dev-driven matrix mode (every `/meta` measure as a row) — offered, not built.
- cube-dev model edits (the WAU/trailing measures) live in the separate `cube-dev` repo and need committing there.
