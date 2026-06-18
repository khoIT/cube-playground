---
phase: 1
title: Canonical metric registry
status: completed
priority: P1
effort: 0.5d
dependencies: []
---

# Phase 1: Canonical metric registry

## Overview

Define, in one config module, the **canonical metric set** the snapshot captures —
(a) per-user state columns (the per-uid state-table schema source-of-truth) and
(b) the segment-level KPI list to persist as a time-series. Everything downstream
(DDL, writers, API, UI) reads from this module so "these are our key segment
metrics" lives in exactly one place.

## Requirements

- Functional: enumerate per-user canonical columns (`mf_users` members + member-column
  fields) and the segment KPI specs (preset `headlineKpis` + Insights-tab `KpiSpec`s).
- Functional: each per-user column declares `{ key, member (logical cube.field),
  kind: 'dimension'|'measure', sqlType: 'VARCHAR'|'DOUBLE'|'BIGINT'|'DATE' }`.
- Non-functional: per-game member pruning — drop a column/KPI whose member is absent
  from a game's `/meta` (reuse the existing pruning in `member-profile-runner.ts`).
- Non-functional: logical member names only; physicalization happens at query time.

## Architecture

- New module `server/src/lakehouse/canonical-metric-set.ts` exporting:
  - `CANONICAL_USER_STATE_COLUMNS: UserStateColumn[]` (table below).
  - `segmentKpiSpecsForPreset(presetId): KpiSpec[]` — union of the preset's
    `headlineKpis` + each Insights tab's `kpis`, deduped by measure ref. Source from
    the already-loaded preset registry; do **not** duplicate the YAML.
  - `pruneColumnsForGame(columns, metaSets, prefix)` — reuse member-existence check.
  - `sqlTypeFor(column)` + a stable column-ordering helper (DDL + INSERT agree positionally).
- Fixed core column set (not per-segment configurable — that option was declined);
  same columns for every mf_users-backed segment, pruned per game.

### Canonical per-user state columns (logical refs, verified)

| key | member | kind | sqlType |
|---|---|---|---|
| `uid` | (identity dim, resolved per cube) | dimension | VARCHAR |
| `ingame_name` | `mf_users.ingame_name` | dimension | VARCHAR |
| `ltv_vnd` | `mf_users.ltv_vnd` | measure | DOUBLE |
| `ltv_30d_vnd` | `mf_users.ltv_30d_vnd` | measure | DOUBLE |
| `is_paying_user` | `mf_users.is_paying_user` | dimension | VARCHAR |
| `is_paying_30d` | `mf_users.is_paying_30d` | dimension | VARCHAR |
| `total_active_days` | `mf_users.total_active_days` | measure | BIGINT |
| `days_since_last_active` | `mf_users.days_since_last_active` | measure | BIGINT |
| `days_since_last_recharge` | `mf_users.days_since_last_recharge` | measure | BIGINT |
| `max_role_level` | `mf_users.max_role_level` | measure | BIGINT |
| `lifecycle_stage` | `mf_users.lifecycle_stage` | dimension | VARCHAR |
| `churn_risk` | `mf_users.churn_risk` | dimension | VARCHAR |
| `engagement_segment` | `mf_users.engagement_segment` | dimension | VARCHAR |
| `payer_tier` | `mf_users.payer_tier` | dimension | VARCHAR |
| `country` | `mf_users.country` | dimension | VARCHAR |
| `os_platform` | `mf_users.os_platform` | dimension | VARCHAR |
| `last_active_date` | `mf_users.last_active_date` | dimension | DATE |
| `install_date` | `mf_users.install_date` | dimension | DATE |

> Re-verify every `mf_users.*` member id against cfm_vn + jus_vn `/meta` during
> implementation (ids drift between games). A missing member is pruned → NULL column,
> never a hard failure.

### Canonical segment KPI list (per preset, verified file:line)

Scalar KPIs already computed by `card-runner` (persist as time-series):

- **mf_users-hub:** `mf_users.user_count`, `mf_users.paying_users`, `mf_users.ltv_total_vnd`,
  `mf_users.arpu_vnd`, `mf_users.paying_users_30d`, `mf_users.paying_rate_30d`,
  `mf_users.lapsed_this_month_count`, `mf_users.ltv_30d_total_vnd`, `mf_users.arppu_vnd`,
  `mf_users.whales_count`.
- **recharge-events:** `recharge.paying_users`, `recharge.revenue_vnd`, `recharge.arppu_vnd`,
  `recharge.transactions`, `recharge.arpt_vnd`.
- **etl_game_detail-hub:** `mf_users.user_count`, `etl_game_detail.matches`,
  `etl_game_detail.kdr`, `mf_users.ltv_total_vnd`, `etl_game_detail.avg_kast`,
  `etl_game_detail.accuracy`, `etl_game_detail.headshot_rate`, `mf_users.paying_users_30d`,
  `mf_users.paying_rate_30d`, `mf_users.ltv_30d_total_vnd`, `mf_users.arppu_vnd`,
  `mf_users.whales_count`.

(Card *breakdowns* not persisted in v1; mf_users distribution trends derive from
per-user state in Phase 7. See plan Open Q3.)

## Related Code Files

- Create: `server/src/lakehouse/canonical-metric-set.ts`
- Read: `server/src/presets/bundles/*.yml`, `server/src/services/member-profile-runner.ts`,
  `cube-dev/cube/model/cubes/{cfm,jus}/mf_users.yml`.

## Implementation Steps

1. Add `UserStateColumn` type + `CANONICAL_USER_STATE_COLUMNS` (table above) + ordering helper.
2. Add `segmentKpiSpecsForPreset` reading the in-memory preset registry, dedupe by measure.
3. Add `pruneColumnsForGame` reusing the `member-profile-runner.ts` existence check.
4. Add `sqlTypeFor`. Re-verify every `mf_users.*` against cfm_vn + jus_vn `/meta`.

## Success Criteria

- [ ] Module exports column set + per-preset KPI list + pruning + sqlType + ordering.
- [ ] Every listed `mf_users.*` verified present in cfm_vn or jus_vn `/meta` (or removed).
- [ ] Unit test: `segmentKpiSpecsForPreset('mf_users-hub')` returns the deduped expected set.
- [ ] No raw YAML duplicated — KPI specs sourced from the loaded registry.
- [ ] `npm run server:build` / `typecheck` clean.

## Risk Assessment

- **Member-name drift across games** → per-game pruning + re-verification; missing = NULL.
- **KpiSpec shape coupling** → import the existing `KpiSpec` type, don't redefine.
