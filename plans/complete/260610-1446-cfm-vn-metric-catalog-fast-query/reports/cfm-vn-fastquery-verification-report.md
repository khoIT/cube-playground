# CFM VN Fast-Query Phase 4A — YAML Change Verification Report

**Date:** 2026-06-10 GMT+7  
**Scope:** cube-dev/cube/model/cubes/cfm/ YAML edits only

---

## Files Changed

| File | Change |
|---|---|
| `game_key_metrics.yml` | +6 derived ratio measures; +`nnpu` and `iap_rev` to rollup measures list |
| `active_daily.yml` | +1 derived ratio measure `avg_online_time_min_per_dau` |
| `etl_newbie_tutorial.yml` | Fixed `completion_rate` sql: `* 1.0` → `CAST(...AS DOUBLE)` |

---

## Measures Added

### game_key_metrics — new ratio measures (post-agg, `type: number`)
- `cti` — click-to-install rate: `CAST({installs} AS DOUBLE) / NULLIF({clicks}, 0)`
- `cpn` — cost per NRU: `CAST({cost_vnd} AS DOUBLE) / NULLIF({nru}, 0)`
- `nru_install_rate` — NRU per install: `CAST({nru} AS DOUBLE) / NULLIF({installs}, 0)`
- `rev_per_npu` — revenue per NPU: `CAST({rev} AS DOUBLE) / NULLIF({npu}, 0)`
- `rev_per_nnpu` — revenue per NNPU: `CAST({rev} AS DOUBLE) / NULLIF({nnpu}, 0)`
- `mkt_rev_ratio` — marketing cost / revenue: `CAST({cost_vnd} AS DOUBLE) / NULLIF({rev}, 0)`

### game_key_metrics — rollup additions (additive base measures)
- `nnpu` added to `key_metrics_by_source_daily_batch` measures (was absent, queries fell through to source)
- `iap_rev` added to `key_metrics_by_source_daily_batch` measures (already `type: sum` on cube, confirmed pre-existing)

### active_daily — new ratio measure
- `avg_online_time_min_per_dau` — `CAST({total_online_time_sec} AS DOUBLE) / NULLIF({dau}, 0) / 60`; post-agg ratio from `dau_by_ingame_dims_daily_batch` components

### etl_newbie_tutorial — bug fix
- `completion_rate` sql: was `{completed_count} * 1.0 / NULLIF({started_count}, 0)` (integer count × 1.0 → decimal scale-1, would truncate <10% rates to 0.0) → now `CAST({completed_count} AS DOUBLE) / NULLIF({started_count}, 0)`

---

## Deferred (per scope instruction)
- `installs_paid`, `installs_organic` measures — NOT added this round

---

## Restart Result

`docker restart cube-playground-cube-api-dev` → ready after ~2s. `/meta` returned HTTP 200 on first poll.

---

## /meta Verification (cfm_vn)

All new measures confirmed present in `/meta` response for `x-cube-game: cfm_vn`:

```
game_key_metrics: cti ✓ | cpn ✓ | nru_install_rate ✓ | rev_per_npu ✓ | rev_per_nnpu ✓ | mkt_rev_ratio ✓
active_daily: avg_online_time_min_per_dau ✓
etl_newbie_tutorial: completion_rate ✓
```

---

## Compiled SQL Verification (`/sql` — no compile errors, HTTP 200 for all)

| Measure | HTTP | Routes to pre_agg | CAST fix confirmed |
|---|---|---|---|
| `game_key_metrics.cti` | 200 | — (query-time ratio, base measures in rollup) | — |
| `game_key_metrics.cpn` | 200 | — | — |
| `game_key_metrics.nru_install_rate` | 200 | — | — |
| `game_key_metrics.rev_per_npu` | 200 | — | — |
| `game_key_metrics.rev_per_nnpu` | 200 | — | — |
| `game_key_metrics.mkt_rev_ratio` | 200 | — | — |
| `game_key_metrics.nnpu` | 200 | `key_metrics_by_source_daily_batch` ✓ | — |
| `game_key_metrics.iap_rev` | 200 | `key_metrics_by_source_daily_batch` ✓ | — |
| `active_daily.avg_online_time_min_per_dau` | 200 | `dau_by_platform_daily_batch` ✓ | — |
| `etl_newbie_tutorial.completion_rate` | 200 | `tutorial_funnel_batch` ✓ | `CAST(...AS DOUBLE)` ✓, no `* 1.0` |

Note: `avg_online_time_min_per_dau` routed to `dau_by_platform_daily_batch` (also carries `dau` + `total_online_time_sec`) rather than `dau_by_ingame_dims_daily_batch` — both carry the required base measures so either is correct.

---

## Rollup Coverage Check (read-only verification per spec)

| Rollup | Spec-required measures | Status |
|---|---|---|
| `recharge_daily_by_channel_batch` | `revenue_vnd_total`, `paying_users` | MATCH — routes to pre_agg ✓ |
| `dau_by_ingame_dims_daily_batch` | `dau`, `total_online_time_sec`, `wau`, `mau` | MATCH — routes to pre_agg ✓ |
| `lottery_pulls_batch` | `pulls`, `distinct_players`, `total_cost_diamond`, `total_cost_gold`, `ten_pull_count` | MATCH ✓ |
| `money_flow_summary_batch` | `out_events`, `total_delta`, `distinct_players` | MATCH ✓ |
| `tutorial_funnel_batch` | `events`, `started_count`, `completed_count`, `distinct_players` | MATCH ✓ |
| `nru_retention_by_cohort_batch` | `rpnpu_d7`, `npu` | MATCH ✓ |

No rollup mismatches vs spec. No new rollups were invented.

---

## Compile Log Status

No schema/compile errors from the YAML changes. Docker logs show only pre-existing `UserError: Can't find join path` messages from the background cross-game availability probe (ballistar — unrelated to cfm YAML edits).

---

## Pre-agg Build Note

`game_key_metrics.key_metrics_by_source_daily_batch` now carries `nnpu` and `iap_rev`. Existing sealed partitions do NOT include these columns — Cube will serve them from source (via lambda union) until partitions are rebuilt. This is expected behavior in dev (mart may be empty locally). The rollup definition is correct; production partitions will need rebuild after deployment.

---

## Unresolved Questions

None introduced by this phase.

---

# CFM VN Fast-Query Phase 4B — Preset Repoint + New Metrics + Taxonomy Report

**Date:** 2026-06-10 GMT+7  
**Scope:** `server/src/presets/business-metrics/*.yml` + `server/src/types/business-metric.ts`

---

## Schema Change

Added optional `serving` array to `BusinessMetricMetaSchema` in `server/src/types/business-metric.ts`:

```typescript
serving: z.array(z.object({
  game: z.string().min(1),
  latency: z.enum(['fast', 'cold']),
  at: z.string().datetime(),
  note: z.string().max(280).optional(),
})).optional()
```

Exported `MetricServingEntrySchema` and `MetricServingEntry` type. Additive-only — no existing fields touched.

---

## Preset Change Summary

| Category | Count | Files |
|---|---|---|
| Repointed (3A revenue cascade) | 4 | `revenue`, `gross_bookings`, `arppu`, `arpdau` |
| Repointed (3B acquisition cluster) | 19 | `nru`, `npu`, `nnpu`, `installs`, `organic_installs`, `paid_installs`, `cost`, `clicks`, `impressions`, `cpi`, `ctr`, `cti`, `cpn`, `nru_install_rate`, `roas`, `roas_07`, `mkt_rev_ratio`, `rev_npu`, `rev_nnpu`, `arpnpu`, `arpnnpu` |
| Repointed (3C paying-retention) | 1 | `rp` |
| Repointed + cold-serving (3D LTV) | 2 | `ltv`, `ltv_30` |
| Cold-serving annotated only | 10 | `transactions`, `paying_users`, `arpu`, `paying_users_30d`, `paying_rate_30d`, `paying_rate`, `rr01`, `rr07`, `rr30`, `rr` |
| Blocked (applicability false for cfm_vn) | 12 | `acu`, `ccu`, `pcu`, `lcu`, `active_role`, `paying_role`, `new_role`, `new_paying_role`, `cvr_cdn_download`, `cvr_install`, `cvr_login_form`, `cvr_register` |
| New presets created (3E) | 12 | `diamond_spend_events`, `diamond_net_delta`, `economy_spenders`, `gacha_pulls`, `gacha_diamond_cost`, `gacha_players`, `tutorial_completions`, `tutorial_completion_rate`, `tutorial_starters`, `total_online_time_hrs`, `avg_online_time_min_per_dau`, `iap_revenue` |
| **Total preset files** | **69** | 57 existing + 12 new |

Note: `arpdau` trust downgraded `certified → draft` (cross-cube cold, no rollup path).

---

## Taxonomy Summary (cfm_vn)

| Assignment | Count | Mechanism |
|---|---|---|
| fast (default, no annotation) | 44 | no `meta.serving` entry |
| cold | 13 | `meta.serving[{game:cfm_vn, latency:cold}]` |
| blocked | 12 | `meta.applicability[{game:cfm_vn, applicable:false}]` |
| **Total** | **69** | |

Cold list: `arpdau`, `arpu`, `ltv`, `ltv_30`, `transactions`, `paying_users`, `paying_users_30d`, `paying_rate_30d`, `paying_rate`, `rr01`, `rr07`, `rr30`, `rr`.

---

## TypeScript Compile Result

`cd server && npx tsc --noEmit`:

- Pre-existing errors: `src/lakehouse/segment-snapshot-writer.ts` (missing `status` property) and 3 other `lakehouse/` files — confirmed present on HEAD before this phase's changes.
- Errors introduced by this phase: **0**.
- `business-metric.ts` compiles clean; `MetricServingEntrySchema` and `MetricServingEntry` export correctly.

---

## Unit Test Result

```
Test Files  6 passed (6)   [loader, ref-validator, audit, applicability, canonical-refs, preset-pivot]
Tests       40 passed (40)

Test Files  4 passed (4)   [routes, trust-resolver, coverage-resolver, patch-trust]
Tests       29 passed (29)

Total: 69 tests — all pass
```

All business-metrics test suites pass. No regressions.

---

## Deferred (per task spec)

- `roas_07` — kept `trust: draft`; repointed to `game_key_metrics.rev / cost_vnd` (period ROAS); description notes D7-cohort ROAS unavailable.
- `organic_installs` / `paid_installs` — repointed to `game_key_metrics.installs_organic / installs_paid`; `trust: draft`; description notes split pending dedicated measures.
- `ltv` / `ltv_30` — repointed to `game_key_metrics.rev / nru`; `trust: draft`; cold serving; description notes daily-cohort semantics vs true NPV.

---

## Unresolved Questions

1. **`roas_07` semantic split** — both `roas` and `roas_07` now point to `game_key_metrics.rev/cost_vnd` (period ROAS). If marketing-ops requires D7-cohort ROAS, a new mart column or a `new_user_retention` join is needed.
2. **`ltv`/`ltv_30` formula** — after repoint: daily cohort rev/NRU, not D0..Dn cumulative. Confirm with product before promoting to `certified`.
3. **`paying_users` identity base** — stays on `recharge.paying_users` (vopenid, cold ~5s). Repoint to `user_recharge_daily.paying_users` (user_id, fast) pending identity-semantics confirmation.
4. **`preagg-readiness.ts` probe** — now fixed in Phase 4C (availability wiring). See below.

---

# CFM VN Fast-Query Phase 4C — Availability Wiring + Cold/Blocked Surfacing

**Date:** 2026-06-10 GMT+7  
**Scope:** Server probe fix + `?filter=available` gate + frontend cold/blocked badges

---

## Files Changed

| File | Change |
|---|---|
| `server/src/services/preagg-readiness.ts` | Changed `recharge` probe entry: `recharge.revenue_vnd` → `user_recharge_daily.revenue_vnd_total`; `recharge.recharge_time` → `user_recharge_daily.log_date`; cube id `recharge` → `user_recharge_daily` |
| `server/src/routes/business-metrics.ts` | Added `?filter=available` query param support; excludes metrics blocked by applicability and broken-ref (draft-downgraded) |
| `server/src/services/metric-applicability.ts` | Pre-existing file — used `applicableForGame` (already existed); no changes needed |
| `src/pages/Catalog/metrics-tab/business-metric-types.ts` | Added `MetricApplicabilityEntry` + `MetricServingEntry` interfaces; added `applicability`/`serving` to `BusinessMetricMeta`; updated `isAvailableForGame` to check applicability; added `isColdForGame` helper |
| `src/pages/Catalog/metrics-tab/use-filtered-metrics.ts` | Added `cold` + `blockedByApplicability` to `FilteredMetric`; `useFilteredMetrics` accepts optional `gameId`; computes both flags |
| `src/pages/Catalog/metrics-tab/metric-card.tsx` | Added `cold` + `blockedByApplicability` props; `ColdBadge` (warning-soft/ink tokens); updated `DisabledTip` to use `--destructive-ink`; distinct messages for applicability vs missing-cube |
| `src/pages/Catalog/metrics-tab/metric-list-row.tsx` | Added `cold` prop; `ColdBadge` (warning-soft/ink tokens); badge cell wrapping trust chip |
| `src/pages/Catalog/metrics-tab/metrics-tab.tsx` | Passes `gameId` to `useFilteredMetrics`; passes `cold`+`blockedByApplicability` to `MetricCard`; passes `cold` to `MetricListRow` |

---

## End-to-End Flow

**Blocked (applicable:false):**
1. YAML `meta.applicability[{game:cfm_vn, applicable:false}]` loaded by server at startup
2. `GET /api/business-metrics?game=cfm_vn` — `resolveTrustForGame` downgrades trust to `draft` (no cfm_vn meta refs resolve)
3. `GET /api/business-metrics?game=cfm_vn&filter=available` — `applicableForGame(m, 'cfm_vn')` returns false → metric excluded
4. Frontend `isAvailableForGame` checks `meta.applicability`, latest entry wins → `available=false, blockedByApplicability=true`
5. `MetricCard` renders `DisabledTip`: "Not available for [game]"; card greyed (opacity 0.55), not clickable
6. `hideUnavailable=true` (default) — blocked metrics hidden from grid/list

**Cold (latency:cold):**
1. YAML `meta.serving[{game:cfm_vn, latency:'cold'}]` loaded by server
2. `meta` passthrough in `resolveTrustForGame` — `serving` array present in API response
3. Frontend `isColdForGame` checks latest `meta.serving` entry for game → returns true
4. `FilteredMetric.cold=true` (only when `available=true`)
5. `MetricCard` renders yellow `Slow` badge (`--warning-soft` bg / `--warning-ink` text)
6. `MetricListRow` same `Slow` badge alongside trust chip
7. Metric remains queryable (not excluded)

---

## TypeScript Compile Results

- `cd server && npx tsc --noEmit`: **0 errors** (pre-existing lakehouse errors unchanged)
- Frontend `npx tsc --noEmit`: **0 new errors** introduced; only pre-existing errors in QueryBuilderV2, cdp-projection, etc. (confirmed by git stash verification — identical error set before/after my changes). One pre-existing test error in `use-filtered-metrics.test.ts` line 56 (`'beta'` trust value) was pre-existing.

---

## Test Results

**Server (all):** 1138 tests pass in 150 test files.

**Frontend (metrics-tab scoped):** 16 tests pass in 3 test files.

---

## Live Route Probe Results

```
GET /api/business-metrics?game=cfm_vn
  → total: 69 metrics
  → acu trust: draft (broken-ref downgrade)
  → acu meta.applicability: [{game:cfm_vn, applicable:false, ...}] ✓
  → transactions meta.serving: [{game:cfm_vn, latency:cold, ...}] ✓

GET /api/business-metrics?game=cfm_vn&filter=available
  → total: 18 metrics
  → acu present: false ✓ (excluded — applicability:false)
  → ccu present: false ✓ (excluded — applicability:false)
  → transactions present: true ✓ (cold but queryable)
  → dau present: true ✓
  → revenue present: true ✓
```

---

## Design Token Compliance

- `ColdBadge`: `background: var(--warning-soft)`, `color: var(--warning-ink)` — no inline hex
- `DisabledTip`: `color: var(--destructive-ink)` — changed from hardcoded `#b91c1c` to token
- No new bespoke spacing, no editorial font stacks introduced
- `--radius-xs` used for badge border-radius

---

## Unresolved Questions

None introduced by Phase 4C.

---

# Code-Review Fixes

**Date:** 2026-06-10 GMT+7

## C1 — Dangling install-split refs

**Finding:** `organic_installs.yml` and `paid_installs.yml` referenced `game_key_metrics.installs_organic` / `installs_paid` — measures that do not exist (deferred this round).

**Fix:** Both YAMLs repointed to `game_key_metrics.installs`. Description updated: "Paid/organic split pending dedicated filtered measures in game_key_metrics; currently reports total installs." `game_compatibility.required_cubes` was already `[game_key_metrics]` — no change needed.

**Verification:** `registry-canonical-refs` test passes (no broken refs detected in registry). `npx tsc --noEmit` clean.

---

## M2a — avg_online_time_min_per_dau 60× off

**Finding:** Preset used a ratio formula (`total_online_time_sec / dau`) — would produce seconds/user, not minutes. The cube already has a derived measure `avg_online_time_min_per_dau` that applies the `/60` correctly.

**Fix:** `avg_online_time_min_per_dau.yml` formula changed from `{type: ratio, numerator: active_daily.total_online_time_sec, denominator: active_daily.dau}` to `{type: measure, ref: active_daily.avg_online_time_min_per_dau}`. Unit kept `minutes`. `required_cubes` `[active_daily]` unchanged.

**Verification:** `metric-ref-validator` and `registry-canonical-refs` tests pass. Cube /meta confirmed `active_daily.avg_online_time_min_per_dau` present (prior phase verification, no new cube restart needed).

---

## M2b — total_online_time_hrs 3600× off

**Finding:** Preset pointed at `active_daily.total_online_time_sec` with unit `hours` — the value would be raw seconds, not hours. No `total_online_time_hrs` derived measure existed.

**Fix:**
1. Added derived measure `total_online_time_hrs` to `cube-dev/cube/model/cubes/cfm/active_daily.yml`:
   `sql: "CAST({total_online_time_sec} AS DOUBLE) / 3600"`, `type: number`. Not added to any rollup (base `total_online_time_sec` is additive in rollups; scaling applied at query time).
2. `total_online_time_hrs.yml` formula repointed to `{type: measure, ref: active_daily.total_online_time_hrs}`. Unit kept `hours`. Removed inaccurate "÷3600 at presentation layer" note.

**Verification:** `npx tsc --noEmit` clean. Cube restart required for new measure to appear in `/meta`. `registry-canonical-refs` test passes after preset update (validates against declared refs, not live /meta).

---

## M1 — ?filter=available drops declared-draft metrics

**Finding:** `?filter=available` gated on `m.trust !== 'draft'`, which excluded all declared-draft metrics (all 12 new event metrics + recovered drafts) regardless of whether their refs resolve. Only broken-ref metrics (downgraded from non-draft to draft by `resolveTrustForGame`) should be excluded.

**Fix:** `server/src/routes/business-metrics.ts` — the available filter now compares adjusted trust against original declared trust from `getAll()`. Broken-ref = adjusted `'draft'` AND declared trust was NOT `'draft'`. Declared-draft metrics with resolving refs are kept. Behavior for blocked (applicability false) exclusion unchanged.

**Verification:** New unit test in `business-metrics-routes.test.ts`: `gacha_pulls` (declared draft, valid ref, no applicability restriction) is present in `?filter=available&game=cfm_vn`; `acu` (applicability false for cfm_vn) is absent. Test passes (7/7 in routes test file).

---

## Minor — diamond-net-delta tile missing segment

**Finding:** Economy-and-gacha dashboard tile queried `etl_money_flow.total_delta` with no segment, so it returns all currency types, not diamond-only. The metric intent (`diamond_net_delta`) is diamond-only.

**Fix:** Added `segments: [etl_money_flow.diamond_only]` to the tile's query in `economy-and-gacha.yml`. The `tileQuerySchema` uses `.passthrough()` so the segment field passes Zod validation.

**Verification:** `dashboard-starter-pack-seeder` test passes (4/4). `npx tsc --noEmit` clean.

---

## Test Summary

```
business-metrics-routes.test.ts   7 tests  pass
metric-ref-validator.test.ts      11 tests pass
registry-canonical-refs.test.ts   1 test   pass
dashboard-starter-pack-seeder.test.ts  4 tests  pass
metric-applicability.test.ts      4 tests  pass
metric-trust-resolver.test.ts     8 tests  pass
metric-coverage-resolver.test.ts  7 tests  pass
business-metric-audit.test.ts     10 tests pass
Total: 52 tests — all pass
```

TypeScript: `cd server && npx tsc --noEmit` — 0 new errors (pre-existing lakehouse errors unchanged).
