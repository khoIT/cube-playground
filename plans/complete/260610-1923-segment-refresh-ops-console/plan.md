---
title: "Segment Refresh Ops Console — cron + queue + card-health monitor"
status: completed
created: 2026-06-10
completed: 2026-06-11
owner: khoitn@vng.com.vn
scope: local devcube stack; Admin/hub UI; server SQLite (read-only over existing tables)
sibling_of: plans/260610-1838-preagg-run-history-console
---

# Segment Refresh Ops Console

> **Status: shipped 2026-06-11.** All 4 phases built in one `/ck:cook --auto` pass.
> Server: `getLastTickAt()` + `TICK_INTERVAL_MS` export (cron-runner), `reconcileSegmentRefreshing(id)`
> (segment-status), `segment-refresh-ops.ts` (derive + collect + watchdog), `routes/segment-refresh-ops.ts`,
> watchdog+heartbeat wired into `tick()`. UI: `segment-refresh-ops-tab.tsx` + `-data.ts` + `segment-refresh-row.tsx`,
> registered in hub `index.tsx` with nav badge. Tests: 14 ops-unit + 3 route + 5 FE-data + 3 FE-tab; cron/refresh +
> hub regression suites green. Watchdog decision: shipped enabled, env-killable via `SEGMENT_REFRESH_WATCHDOG_ENABLED`.

## Goal

Give an operator a UI to see the health of the **segment refresh cron** (path B —
gateway-side cohort + KPI-card recompute), as a sibling tab to the **Pre-agg Runs**
tab (path C — worker rollup sweeps). Per segment: is it refreshing on cadence, is
it **wedged in `refreshing`**, is it serving last-good after a failed refresh, and
which **KPI cards are erroring** (cold-query / unbuilt-rollup). Plus a cron
heartbeat + queue depth so "is the background job even running?" is answerable at a
glance.

## Why now

- We just root-caused a **stuck-`refreshing` deadlock** (segments wedged for days,
  invisible to the cron because `listDueSegments()` skips `refreshing`). Boot-time
  reconciliation now recovers them, but there is **no surface** to see it happening
  or catch the next failure mode (a live gateway whose worker dies between
  restarts, a segment whose cards perpetually error).
- The data already exists in SQLite — this is a **read-only view over existing
  tables**, far lighter than the preagg console's log-parsing. It shouldn't wait
  behind that plan's log-file-wiring risk.
- Same operator, same mental model ("background refresh telemetry"), same home
  (`src/pages/Admin/hub`) → one **Refresh Ops** hub area, two tabs.

## Key facts (verified this session)

- **Cron** = in-process `setInterval`, **60s tick** (`cron-runner.ts:17`,
  `TICK_INTERVAL_MS`). Each tick: `listDueSegments()` (predicate segments past
  `refresh_cadence_min`, **skipping `status='refreshing'`**) → `enqueueRefresh()`.
- **Queue** = in-memory FIFO, single-instance, no overlap (`refresh-queue.ts`).
  Already exposes `isProcessing()` and `queueSize()` — currently unsurfaced.
- **Worker** per segment: `refresh-segment.ts` sets `refreshing` at start (:86) →
  `fresh` on success (:225) | `stale` on transient net error (:306) | `broken` on
  hard error (:310); runs `runPresetCards()` → `upsertCardCache()` (:296).
- **All telemetry is already in SQLite** (`server/data/segments.db`):
  - `segments`: `status, last_refreshed_at, refresh_cadence_min, uid_count, broken_reason, game_id, workspace`.
  - `segment_refresh_log`: `segment_id, ts, status, uid_count` (per-run history; success + broken rows).
  - `segment_card_cache`: `card_id, status('ok'|'error'), error, fetched_at` (per-card health; last-good preserved on error).
- **Two gateways, two DBs, two crons** (verified): host tsx → `:3000`,
  `server/data/segments.db`; docker `server-1` → `:11000`, `/data/segments.db`. The
  monitor reads **this gateway's own DB** — it is per-instance, not global.
- **Cron heartbeat is not tracked today** — `cron-runner.ts` has no `lastTickAt`.
  One tiny export needed (Phase 1).
- **Home + pattern:** `src/pages/Admin/hub`. Mirror the preagg trio exactly:
  `preagg-runs-tab.tsx` + `preagg-runs-data.ts` + `preagg-runs-sweep-row.tsx`,
  registered via `buildAdminTabs()` `TabDef` (`index.tsx:45`) + a sibling
  `<Route exact path="/admin/preagg-runs">`. Follow `docs/design-guidelines.md`
  (tokens, page-header pattern, status tokens).

## Outcome taxonomy (per segment — the data model's heart)

Derived by combining `segments.status` + age-vs-cadence + card tallies. No new
status column — purely a computed view.

| derived state | basis | meaning |
|---|---|---|
| `healthy` | `fresh`, age ≤ cadence, all cards `ok` | refreshed on time, serving warm |
| `due` | `fresh`/`stale`, age > cadence, not in queue | past cadence, awaiting next tick (normal) |
| `in_flight` | `refreshing`, age < wedge threshold | actively refreshing now |
| `wedged` | `refreshing`, age ≥ wedge threshold | **stuck — orphaned mid-refresh** ← key signal |
| `serving_stale` | `stale`, has prior cohort/cards | last refresh failed (transient); serving last-good |
| `broken` | `broken` | hard failure; show `broken_reason` |
| `degraded` | any serving state, but K of N cards `status='error'` | cohort ok, but KPI cards cold-failing (timeout / unbuilt rollup) |

`wedged` and `degraded` are the two signals that don't exist anywhere today and
are the whole reason for the tab — render them with the **warning/destructive**
status tokens, visually distinct from `healthy`.

### Wedge threshold — operational role (not just display)

The threshold classifies a `refreshing` row as `wedged` (vs benign `in_flight`),
**and** drives a runtime watchdog. Mechanics it has to respect:

- The cron tick never re-evaluates `refreshing` rows (`listDueSegments()` skips
  them, `cron-runner.ts:61`); the queue is in-memory. So a row that wedges
  *without* a process restart stays stuck until the next boot — the boot-time
  `reconcileOrphanedRefreshing()` is the only recovery and it can't reach a
  long-lived gateway.
- **Watchdog closes that gap:** each tick, any `refreshing` row whose age exceeds
  the threshold is reconciled to `stale` (single-id form of the boot reconcile),
  so it self-heals within one tick (≤60s) instead of waiting for a restart. The
  manual **Unstick** button is the same op, on demand.
- Threshold MUST sit above the longest legitimate single-segment refresh (the
  7.16M-cohort case) or a slow-but-healthy run gets falsely killed. Default
  `max(cadence, 10min)`, env-configurable, documented.

## Phases

| # | Phase | Output |
|---|-------|--------|
| 1 | Server: heartbeat + aggregation route | Add `getLastTickAt()` to `cron-runner.ts`. New `GET /api/segment-refresh/ops` (zod-typed): `{ cron:{lastTickAt,tickIntervalMs}, queue:{processing,size}, segments:[{id,name,game_id,status,derivedState,lastRefreshedAt,cadenceMin,ageMs,overdueBy,uidCount,brokenReason,cards:{ok,error,total}}] }`. Wedge threshold = `max(cadence, FLOOR_MIN)` (default 10min), config via env. Read-only over existing tables + queue introspection. |
| 2 | Admin/hub UI tab + nav badge | "Segment Refreshes" tab: cron heartbeat strip (last tick + queue depth + "N wedged / N degraded" counts), segment table with status chip, age-vs-cadence bar, per-card ok/error tally, expand → erroring card ids + messages. `TabDef` + `<Route>` registration. **Hub-nav badge** showing `wedged`+`degraded` count (mirror the Observability "N pending" badge — surfaces the alarm without opening the tab; 0 → no badge). Design tokens. |
| 3 | Operator actions + watchdog | Per-segment **Refresh now** (reuse `POST /api/segments/:id/refresh`) + **Unstick** (new `POST /api/segment-refresh/:id/unstick` → single-id reconcile to `stale`). Both gated `editor,admin`. **Watchdog:** in the cron tick, auto-reconcile any `refreshing` row past the wedge threshold to `stale` (reuse the single-id unstick path) — self-heals wedges between restarts. Shipped in the first cut. |
| 4 | Tests + docs | route test (aggregation + wedge/degraded derivation, empty-DB), `*-data.ts` helper unit test (state derivation table), tab render test, **watchdog test** (refreshing-past-threshold → stale; in-flight-under-threshold untouched), unstick route test; changelog + journal; cross-link `docs/query-paths-and-service-topology.md` §7 + `system-architecture.md`. |

## Architecture

- **No new persistence.** Everything is a `SELECT` over `segments`,
  `segment_refresh_log`, `segment_card_cache` + the in-memory `queueSize()`/
  `isProcessing()` + a new `lastTickAt` heartbeat. No migration, no log parsing.
- **Derivation lives server-side** in a small pure helper
  (`server/src/services/segment-refresh-ops.ts`) so the state taxonomy is unit-
  testable without HTTP. Route is a thin wrapper.
- **Unstick + watchdog reuse one path.** Add `reconcileSegmentRefreshing(id)`
  (single-id form of the existing `reconcileOrphanedRefreshing()`) to
  `segment-status.ts`. The Unstick route, and the cron-tick watchdog, both call
  it — one tested op, two triggers. No duplicate reset logic.
- **Per-instance by design.** The tab shows the gateway that served it (its own
  SQLite). Label it so an operator isn't confused that `:3000` and `:11000` differ
  (cross-ref the two-gateway note in `query-paths-and-service-topology.md` §1/§8).
- **Reuse, don't fork:** `getDb()`, the preagg tab/data/row component shape, the
  `TabShell`/`TabDef` registration, design tokens.

## Key dependencies / order

Phase 1 (route+helper) → 2 (UI) → 3 (optional actions) → 4 (tests/docs).
Independent of the preagg plan except for sharing the hub IA — they can be cooked
in parallel; only `index.tsx` `buildAdminTabs()` is a shared touch-point (append
one `TabDef` + one `<Route>`; no conflict if sequenced).

## Out of scope

- **Prod stack** — local devcube only this round; mirror once shape is proven
  (prod config must land in both registries per workspace-config rollout rule).
- **Cross-gateway aggregation** — no rollup of host + docker into one view; each
  instance reports itself. A unified view would need a shared store (YAGNI now).
- **Triggering pre-agg builds** — that's the preagg console's domain; this tab is
  segment-cron only.
- **Changing cron cadence / queue concurrency** — monitor only, not a control
  panel. The only writes are Refresh-now, Unstick, and the wedge watchdog — all
  reconcile/enqueue ops, no scheduling/concurrency knobs.

## Risks

- **Wedge-threshold tuning** — too tight → false `wedged` on a legitimately long
  7.16M-cohort refresh; too loose → slow to flag a real stuck row. Default
  `max(cadence, 10min)`; make it env-configurable and document the trade-off.
- **Two-gateway confusion** — operator sees different segments at `:3000` vs
  `:11000`. Mitigate with an explicit instance label + cross-ref to the topology doc.
- **`segment_refresh_log` may be sparse** (retention prune; observed empty on host
  DB) — treat run-history as best-effort; derive live state from `segments` +
  `segment_card_cache`, not from the log.

## Resolved decisions

- **Wedge threshold:** `max(cadence, 10min)`, env-configurable. Operational, not
  cosmetic — also drives the watchdog (see "Wedge threshold — operational role").
- **Nav badge:** yes — show `wedged`+`degraded` count on the hub nav, mirroring
  the Observability "N pending" badge; 0 → no badge.
- **Operator actions:** Refresh-now + Unstick ship in the first cut (Phase 3, not
  optional), plus the runtime watchdog.

## Open questions

- Watchdog auto-reconcile: log-only first run, or write from day one? (Leaning
  write from day one — it's the same op as boot reconcile, already proven safe —
  but a one-release log-only soak would surface any false-wedge before it
  auto-kills a slow-but-healthy refresh. Flagging for your call at cook time.)
