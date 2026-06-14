---
phase: 2
title: query-builders
status: completed
effort: 1.5h
---

# Phase 2: Query builders for the new charts + members list

## Overview

**Priority:** P2 · **Status:** pending · **Depends on:** P1 only for the heatmap builder's
dim refs (the builder can be written before P1 deploys — it just won't return rows yet).

Extend `ops-overview-queries.ts` with pure builder functions for the 5 new data series +
the members list. All builders are pure `(gameId, range) => Query` (or `() => Query` for
snapshots), so P7 statically asserts the invariants (no-PII on Overview, VND filter, ≤31d
implied by range). Reuse the existing `vndFilter` + `range` helpers — DRY.

## Requirements / data contracts (verified 2026-06-14)

| Builder | Measures / dims | Time dim + granularity | Filter |
|---------|-----------------|------------------------|--------|
| `spendDailyTrendQuery(gameId, r)` | `marketing_cost.cost_vnd` | `marketing_cost.log_date` day | none (cost is VND already) |
| `dauDailyQuery(r)` | `active_daily.dau` | `active_daily.log_date` day | none |
| `csTrendDailyQuery(r)` | `cs_ticket_detail.total_tickets`, `.negative_sentiment_tickets` | `cs_ticket_detail.created_date` day | none |
| `payerTierConcentrationQuery()` | `mf_users.user_count`, `mf_users.ltv_total_vnd` ; dim `mf_users.payer_tier` | none (snapshot) | none |
| `purchaseHeatmapQuery(gameId, r)` | `billing_detail.cash_charged_gross` ; dims `billing_detail.hour_of_day`, `.day_of_week` | `billing_detail.order_date` dateRange, **NO granularity** | `vndFilter(gameId)` |
| `topPayersQuery(limit=50)` | `mf_users.ltv_total_vnd` ; dims `mf_users.user_id`, `.ingame_name`, `.payer_tier`, `.last_login_date`, `.lifetime_txn_count` | none (snapshot) | none; `order: {'mf_users.ltv_total_vnd':'desc'}`, `limit` |

Verified refs: `marketing_cost.cost_vnd` (cfm:123) @ `log_date` (cfm:37); `active_daily.dau`
(cfm:103) @ `log_date` (cfm:35); `cs_ticket_detail.total_tickets` (cfm:162) +
`.negative_sentiment_tickets` (cfm:185) @ `created_date` (cfm:101); `mf_users.payer_tier`
(cfm:181), `.user_count` (cfm:256), `.ltv_total_vnd` (cfm:264), `.user_id` (cfm:35),
`.ingame_name` (cfm:40), `.last_login_date` (cfm:80), `.lifetime_txn_count` (cfm:159).
All present in jus YAMLs (cube parity confirmed). billing order ts `order_created_datetime`;
jus mixed-currency → `vndFilter`.

## Architecture / data flow

```
range (OpsRange, ≤31d) ──┬─> spendDailyTrendQuery ─┐
                         ├─> dauDailyQuery          ├─> day-keyed series → P3 joins by date
                         ├─> csTrendDailyQuery      ┘
                         └─> purchaseHeatmapQuery (no granularity) → [hour,dow,cash] grid
(snapshot, no range) ────┬─> payerTierConcentrationQuery → tier→{count,ltv} → % of total LTV
                         └─> topPayersQuery → per-user rows (ONLY query with user_id; F3)
```

**Invariant boundary:** `topPayersQuery` is the ONLY new builder carrying a per-user dim
(`mf_users.user_id`). Every OTHER new builder is aggregate-only → P7 asserts no `user_id`
dim/filter on the Overview builders. Extend the existing file-header "no PII" note to carve
out topPayersQuery ("powers the user-approved members list").

## Related code files

- Modify: `src/pages/OpsConsole/ops-overview-queries.ts` (append 6 builders). If it crosses
  200 LOC, split `topPayersQuery` into a sibling `ops-members-queries.ts` (modularize).

## Implementation Steps

1. Add `spendDailyTrendQuery`, `dauDailyQuery`, `csTrendDailyQuery` mirroring the existing
   `billingDailyTrendQuery` shape (day granularity + asc order on the time dim).
2. Add `payerTierConcentrationQuery()` — snapshot: dim `payer_tier`, measures count + ltv.
   KISS: no gameId param (no filter needed).
3. Add `purchaseHeatmapQuery(gameId, r)` — dims `[hour_of_day, day_of_week]`, measure cash,
   `timeDimensions:[{dimension:'billing_detail.order_date', dateRange:range(r)}]` with NO
   `granularity` (period total per hour×dow cell, not a per-day series), `vndFilter(gameId)`.
4. Add `topPayersQuery(limit=50)` — dims listed above, measure ltv, order ltv desc, `limit`.
   Header comment explains the *why* (deliberate per-user query for the members list, not a
   leak). NO plan/finding refs.
5. Reuse `vndFilter`/`range`. tsc clean.

## Todo

- [ ] spendDailyTrendQuery / dauDailyQuery / csTrendDailyQuery added (day granularity, asc)
- [ ] payerTierConcentrationQuery added (snapshot, payer_tier dim)
- [ ] purchaseHeatmapQuery added (hour+dow dims, NO granularity, vndFilter)
- [ ] topPayersQuery added (user_id dim, order desc, limit; isolated + documented)
- [ ] file-header "no PII" note carves out topPayersQuery
- [ ] reuses vndFilter/range; tsc clean

## Success Criteria

- All 6 builders return well-typed `Query` objects; `tsc --noEmit` passes.
- Overview builders carry zero per-user dims/filters; only `topPayersQuery` has `user_id`.
- jus heatmap builder includes the VND filter.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Heatmap builder refs P1 dims before deploy | HIGH | Heatmap query 4xx | Builder correct by contract; rows only post-P1 deploy; P4 empty-state. |
| Forgetting VND filter on heatmap (jus) | MED | USD pollutes VND cash | Reuse `vndFilter(gameId)`; P7 asserts it. |
| dau time dim name wrong | LOW | dau query empty | Verified `log_date` (active_daily.yml:35). |

## Next Steps

P3 consumes these builders in the data hook.
