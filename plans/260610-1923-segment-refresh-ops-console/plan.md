---
title: "Segment Refresh Ops Console — cron + queue + card-health monitor"
status: pending
created: 2026-06-10
owner: khoitn@vng.com.vn
scope: local devcube stack; Admin/hub UI; server SQLite (read-only over existing tables)
sibling_of: plans/260610-1838-preagg-run-history-console
---

# Segment Refresh Ops Console

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

## Phases

| # | Phase | Output |
|---|-------|--------|
| 1 | Server: heartbeat + aggregation route | Add `getLastTickAt()` to `cron-runner.ts`. New `GET /api/segment-refresh/ops` (zod-typed): `{ cron:{lastTickAt,tickIntervalMs}, queue:{processing,size}, segments:[{id,name,game_id,status,derivedState,lastRefreshedAt,cadenceMin,ageMs,overdueBy,uidCount,brokenReason,cards:{ok,error,total}}] }`. Wedge threshold = `max(cadence, FLOOR_MIN)` (default 10min), config via env. Read-only over existing tables + queue introspection. |
| 2 | Admin/hub UI tab | "Segment Refreshes" tab: cron heartbeat strip (last tick + queue depth + "N wedged / N degraded" counts), segment table with status chip, age-vs-cadence bar, per-card ok/error tally, expand → erroring card ids + messages. `TabDef` + `<Route>` registration. Design tokens. |
| 3 | (optional) Operator actions | Per-segment **Refresh now** (reuse `POST /api/segments/:id/refresh`) + **Unstick** (new `POST /api/segment-refresh/:id/unstick` → single-id reconcile to `stale`). Gated `editor,admin`. Build only if read-only proves insufficient. |
| 4 | Tests + docs | route test (aggregation + wedge/degraded derivation, empty-DB), `*-data.ts` helper unit test (state derivation table), tab render test; changelog + journal; cross-link `docs/query-paths-and-service-topology.md` §7 + `system-architecture.md`. |

## Architecture

- **No new persistence.** Everything is a `SELECT` over `segments`,
  `segment_refresh_log`, `segment_card_cache` + the in-memory `queueSize()`/
  `isProcessing()` + a new `lastTickAt` heartbeat. No migration, no log parsing.
- **Derivation lives server-side** in a small pure helper
  (`server/src/services/segment-refresh-ops.ts`) so the state taxonomy is unit-
  testable without HTTP. Route is a thin wrapper.
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
  panel (except the optional Phase-3 unstick/refresh actions).

## Risks

- **Wedge-threshold tuning** — too tight → false `wedged` on a legitimately long
  7.16M-cohort refresh; too loose → slow to flag a real stuck row. Default
  `max(cadence, 10min)`; make it env-configurable and document the trade-off.
- **Two-gateway confusion** — operator sees different segments at `:3000` vs
  `:11000`. Mitigate with an explicit instance label + cross-ref to the topology doc.
- **`segment_refresh_log` may be sparse** (retention prune; observed empty on host
  DB) — treat run-history as best-effort; derive live state from `segments` +
  `segment_card_cache`, not from the log.

## Open questions

- Wedge threshold default — `max(cadence, 10min)`, or a flat 15min? (cadences in
  play: 60 / 720 / 1440 min.)
- Should `wedged`/`degraded` counts raise a badge on the hub nav (like the
  Observability "N pending" badge), or is the tab enough for v1?
- Include Phase 3 operator actions in the first cut, or ship read-only and add
  actions only if the boot-reconcile + watchdog prove insufficient?
