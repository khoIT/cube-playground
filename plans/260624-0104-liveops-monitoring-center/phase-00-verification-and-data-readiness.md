# Phase 00 — Verification & data readiness

**Priority:** P0 (gate) · **Status:** ✅ · Read-only investigation + one data-readiness doc. No prod code.

> **Verdict (2026-06-24):** all surfaces green. Lifecycle DERIVE→GO (`mf_users.lifecycle_stage`, weekly forward-only), SKU BUILD (cfm+jus `recharge.product_id`), Portfolio GO (common subset via `game_key_metrics`), nav RESTRUCTURE-ONLY, ops-overview LIFT-AS-IS. Full report: `reports/data-readiness-report.md`.

## Why
Three surfaces depend on data facts that are unverified. Build order must not start until each is
proven or a derivation is chosen. Also confirms nav-visibility state for the "revive" ask.

## Tasks
1. **Lifecycle states (blocks Phase 04).** Determine how to label players New / Core / Lapsing /
   Reactivated / Churned. No Cube dimension exists. Evaluate, pick one, document the exact rule:
   - (a) derive from cohort retention buckets (active_daily recency + first-seen), or
   - (b) from segment-membership lakehouse snapshot **delta** (stag_iceberg.khoitn.segment_membership_daily) → from_state/to_state counts, or
   - (c) compute on the fly in a new backend service.
   Output: state definitions (recency windows) + which games can serve them + whether transitions need a serve-layer rollup.
2. **SKU/pack revenue (Phase 05).** Confirm whether `recharge`/`billing_detail` expose `sku_code`/`pack_price`/product columns per game (probe Cube meta + Trino). If absent, scope Monetization v1 to tier + LTV + concentration only; mark SKU "data not available".
3. **Cross-game KPI parity (Phase 07).** Enumerate which measures (DAU, revenue_vnd_real, payer_rate, arppu, d7) exist on all 8 games vs cfm/jus-only. Output the **common KPI subset** the portfolio row will use; list per-game gaps.
4. **Nav visibility (Phase 01).** Confirm current state of LiveOps in `Settings/use-visible-nav-items.ts` blocklist + `auth/feature-access.ts`. Decide whether "revive" needs: un-blocklist on migration, a role-gate change, or just IA restructure.
5. **Ops Overview reuse (Phase 01).** Read `OpsConsole/ops-overview-queries.ts` + `overview-trends.tsx`; confirm the trend queries can be lifted into Command Center unchanged (game-scoped) and which need an "All games" variant.

## Files to read
`server/src/jobs/anomaly-detector.ts`, `Segments/compare/use-segment-overlap.ts`, segment snapshot job
`server/src/jobs/snapshot-segment-membership.ts`, `OpsConsole/ops-overview-queries.ts`,
`OpsConsole/overview-trends.tsx`, `Header/use-game-context.ts`, cube model under `cube-dev/cube/model/cubes/{cfm,jus,...}`.

## Deliverable
`plans/260624-0104-liveops-monitoring-center/reports/data-readiness-report.md` with a **go / derive / defer**
verdict per surface (Sankey, Monetization-SKU, Portfolio) + the chosen lifecycle-state rule + common KPI subset.

## Success criteria
- [ ] Lifecycle-state rule chosen + which games serve it + transition-data source named.
- [ ] SKU availability confirmed per game (cfm_vn, jus_vn at minimum).
- [ ] Common cross-game KPI subset listed with per-game gaps.
- [ ] Nav-revive action decided (restructure-only vs blocklist/role change).
- [ ] Ops-overview-query reuse confirmed (lift-as-is vs needs All-games variant).

## Risks
- Lifecycle transitions may need a serve-layer rollup (snapshot delta is daily) → if so, Phase 04 gains a rollup sub-task or defers to weekly granularity only.
