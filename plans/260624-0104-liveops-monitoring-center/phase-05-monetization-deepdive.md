# Phase 05 — Monetization deep-dive

**Priority:** P1 · **Status:** ☐ · Depends: 00 (SKU verdict), 01

## Goal
A monetization economics page: payer-tier distribution (+ migration), realized LTV-by-cohort curves,
SKU/pack performance (if data confirmed), and revenue concentration (Pareto). Descriptive only.

## Key insights
- Strong reuse: `OpsConsole/members-top-payers.tsx` (tier badges), `ops-overview-queries.ts`, cube `billing_detail.cash_charged_gross`, `mf_users.{ltv_total_vnd,payer_tier}`, `revenue_vnd_real`.
- **Realized** LTV (actual cumulative revenue by install cohort), not predicted — no model.
- SKU/pack section gated by Phase 00 (`sku_code`/`pack_price` confirmation); if absent, ship without it + "data not available".

## Architecture
- Page `Liveops/monetization/index.tsx` with sections (cards on CardShell pattern):
  1. Payer-tier distribution (whale/dolphin/minnow counts + revenue share) — reuse tier dimension + badges.
  2. Tier migration WoW (small Sankey/flow or delta table) — reuse lifecycle ribbon or BarList delta.
  3. Realized LTV-by-cohort (line chart: cumulative revenue per install-week cohort over age) — AssistantChartSection multi-line, `indexed` option.
  4. Revenue concentration / Pareto (cumulative revenue vs cumulative payers; Gini number).
  5. SKU/pack performance (conditional) — BarList of top SKUs by revenue.
- Backend only where Cube can't do it directly (LTV-by-cohort age matrix, Pareto cumulative) → `chat-service` or `server` helper; otherwise direct Cube queries via existing query hooks.

## Files
- Create: `src/pages/Liveops/monetization/index.tsx`, `.../monetization/{payer-tier-card,tier-migration-card,ltv-cohort-card,revenue-concentration-card,sku-performance-card}.tsx`, `.../monetization/use-monetization-queries.ts`.
- Backend (if needed): `server/src/routes/monetization-cohort-ltv.ts` + service for cohort×age cumulation + Pareto.
- Reuse: `members-top-payers.tsx` badge styles, `assistant-chart-section.tsx`, `Segments/visuals/bar-list.tsx`, `Segments/detail/cards/card-shell`.

## Steps
1. Payer-tier distribution + revenue-share card (direct Cube query).
2. Realized LTV-by-cohort matrix (backend cumulation) → multi-line card.
3. Revenue concentration (Pareto curve + Gini) card.
4. Tier-migration card (WoW), reusing lifecycle ribbon or delta table.
5. SKU/pack card behind Phase-00 flag; otherwise render "data not available" placeholder.

## Success criteria
- [ ] Tier distribution + revenue share render for cfm_vn & jus_vn.
- [ ] LTV-by-cohort lines plausible (monotonic non-decreasing cumulative) and indexed-comparable.
- [ ] Pareto + Gini computed; concentration reads correctly (e.g. top 1% payers → X% revenue).
- [ ] SKU card present only when columns confirmed; clean fallback otherwise.

## Risks
- jus_vn billing mixes USD/VND (per memory) — apply the documented VND filter / prefer `recharge.revenue_vnd_real`; don't sum mixed currencies.
- LTV-by-cohort over long age windows = heavy Trino scans → cap age (e.g. D0–D90), use rollups/preaggs where available, cold-read wait handling.
