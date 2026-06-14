---
phase: 3
title: "Overview tab — cards + trends"
status: completed
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 3: Overview tab — window-aware cards + trend charts

## Overview
The net-new data surface. Build the window-aware Overview matching the approved mockup
(`ops-console-overview.html`): hero cards with Δ-vs-prior-period + sparklines, three trend charts, and
six analysis panels. All data via aggregate Cube queries (no user_id filter) → no per-user rows → no PII.

## Requirements (card set finalized by the 2026-06-14 data audit — real measures only)
- Functional: for the selected window (7d/30d/MTD) the tab shows —
  - **Hero cards:** Cash revenue (`billing_detail.cash_charged_gross`), Transactions
    (`txn_count_total`), Paying users (`paying_users`) — each with Δ vs prior equal-length period +
    sparkline; plus **Cross-border whale LTV** (`mf_users.geo_moved`) and **Lifetime recon gap**
    (`billing_lifetime` vs `mf_users` LTV, +42% real). Money NEVER from `recharge.revenue_vnd` (9×
    inflated units) — use `cash_charged_gross` / `recharge.revenue_vnd_real`.
  - **Trends:** (1) Cash collected daily; (2) Paying users vs cash (divergence); (3) Gateway mix over
    time (stacked). All real; billing queries bounded ≤31d.
  - **Panels:** Payment gateway mix (`payment_gateway`); Support health (`cs_ticket_detail` — tickets,
    CSAT, negative-sentiment, unresolved-member, avg-resolution; ~2d lag tag); **Lifetime reconciliation**
    (`billing_lifetime.lifetime_vnd_total` ₫508B vs `mf_users.ltv_total_vnd` ₫358B, +42%, gross-only);
    **Cross-border (geo_moved)** from `mf_users` (movers count + LTV + avg-vs-base multiple); **Acquisition
    & spend** (`marketing_cost`: cost_vnd, CPC, CPM + **blended** ROAS = revenue_vnd_real ÷ spend; cohort
    ROAS/CPI/CAC flagged as needs paid-install join — DEFERRED).
  - **DROPPED (not real):** promo-aware ARPU (`promo_charged_gross`=0), store card (1:1 with gateway),
    item_type (single value "PACKAGE").
- Non-functional: billing grouping bounded ≤31d (raw is correct, no fan-out — audit); tokens only;
  every lagging source tagged with its freshness; no fabricated splits.

## Query discipline (red-team — non-negotiable)
- **A1 distinct measures:** `paying_users` (count_distinct_approx) headline = ONE query with the window
  `dateRange` and NO day granularity. The daily payers trend series is display-only — NEVER summed to a
  total (a user paying 10 days would count 10×). Same rule for any distinct measure.
- **A2 jus currency:** jus `billing_detail` is mixed USD+VND — jus money tiles filter `currency='VND'`
  (label "VND-charged") OR use `recharge.revenue_vnd_real`. cfm (A49) is VND-only, no filter needed.
- **A4 snapshots:** `billing_lifetime` + `mf_users` are snapshots (no usable date dim) → the lifetime-
  wedge and travel-signal cards are **as-of {date}, no window re-scope, no Δ**. Render them outside the
  window toggle's effect.
- **7d-Δ only:** Δ-vs-prior pills appear ONLY on the 7d window (additive billing tiles). 30d shows no Δ
  (no data before ~mid-May). MTD shows no Δ.
- **A8 ROAS:** denominator pinned to `marketing_cost.cost_vnd`; label "revenue ÷ spend (blended, not
  cohort)"; cohort ROAS/CPI/CAC deferred (needs paid-install join).
- **A5 geo label:** "first ≠ last login country (travel / VPN / account-sharing signal)" — count + LTV
  only, no "Nx richer" framing (selection bias).
- **A10 PII:** no Overview query carries `user_id`/`member_user_id`/`ingame_name`/`vip_id` in filters OR
  dimensions; any grouped tile enforces a k-anonymity floor (drop rows with n < k).
- **B4 ready gate:** issue Overview queries only when `useGameContext().ready && cfm/jus` (gameId
  defaults to `'ballistar'` pre-ready).

## Architecture
- `overview-tab.tsx` orchestrates; one data hook per logical group (`use-ops-overview-headline.ts`,
  `use-ops-trends.ts`, `use-ops-gateway-mix.ts`, `use-ops-support.ts`, `use-ops-reconciliation.ts`,
  `use-ops-promo-arpu.ts`, `use-ops-acquisition.ts`, `use-ops-geo.ts`) each calling `useMemberCubeQuery`
  (or a thin aggregate variant) with the current window's `dateRange` + a prior-period `dateRange`.
- Window → `{current:[start,end], prior:[pstart,pend]}` computed in a pure `ops-window.ts` util (unit-
  tested in Phase 6). Δ = (current-prior)/prior.
- Promote the StatCard idiom into a small shared `ops-stat-card.tsx` (copy from portfolio-strip:34-75).
- Trend charts: lightweight inline SVG (mockup geometry pattern) OR the app's existing chart lib if one
  is already used by dashboards — check before adding a dep (YAGNI; prefer existing).

## Related Code Files
- Create: `src/pages/OpsConsole/overview-tab.tsx`, `ops-stat-card.tsx`, `ops-trend-chart.tsx`,
  `ops-window.ts`, and the `use-ops-*.ts` hooks above.
- Reference: `use-member-cube-query.ts`, `cubejs-api.ts`, `portfolio-strip.tsx` (card),
  the ops cube measures (`billing_detail`, `billing_lifetime`, `cs_ticket_detail`, `user_identity`,
  `marketing_cost`, `recharge`, `mf_users`).

## Implementation Steps
1. `ops-window.ts` — window → current/prior date ranges (7d/30d/MTD).
2. `ops-stat-card.tsx` + `ops-trend-chart.tsx` (reusable).
3. Headline hook + hero cards with Δ + sparkline.
4. Trend hooks + the 3 charts (daily cash; payers-vs-cash; gateway-mix stacked). Bound billing ≤31d.
5. The 5 panels, each its own hook (gateway mix, support health, lifetime reconciliation, cross-border
   geo_moved from mf_users, acquisition & spend). No promo/store/item_type cards.
6. Honesty states: reconciliation labels gross-only; cohort ROAS marked "needs paid-install join
   (deferred)"; each lagging source (CS ~2d) tagged with its freshness in the UI.
7. Compile-check + manual verify against the audited live cfm numbers (cash ₫43.96B/30d, payers 50.4k,
   gateway VNG67/Apple24/Goog9, geo movers 19,834, recon +42%).

## Success Criteria
- [ ] All tiles re-scope correctly on window change; Δ-vs-prior computed from real prior-period queries.
- [ ] Cash/gateway numbers match the audited live values (no fabricated splits).
- [ ] No query carries a user_id filter or PII dimension (aggregate-only).
- [ ] No promo/store/item_type cards; cohort ROAS flagged deferred; freshness tags on lagging panels.
- [ ] Tokens only; no new tsc/lint/build errors.

## Risk Assessment
- Many small queries → use the existing concurrency semaphore in `use-member-cube-query`; batch where the
  same cube+grain can serve multiple tiles (avoid N+1 to Cube).
- billing_detail is scan-guarded (≤31d bound) — the 30d window is fine; MTD ≤31d; never issue an unbounded
  billing query. Raw is correct per the audit (no fan-out), so Phase 2 is not a prerequisite.
- **jus shape differs:** gateway mix is ~99.5% VNG (1 meaningful bar) → render gracefully (don't imply a
  rich mix); blended ROAS for jus ~6.8× is fine; cohort ROAS deferred for both games.
- **`recharge.revenue_vnd` is banned** (9× inflated units) — lint/review check that money tiles use
  `cash_charged_gross` / `revenue_vnd_real` only.
