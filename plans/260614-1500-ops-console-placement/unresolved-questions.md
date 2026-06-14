# Unresolved Questions — Ops Console (/ops)

Build-gating / decision items to resolve before or during implementation.

1. **Sidebar gating — RESOLVED.** No `'ops'` feature key (closed `NavItemId`/`FeatureKey` unions,
   server-mirrored — won't compile). Nav item under the existing `dashboards` section, gated
   `showSection('dashboards') && ['cfm','jus'].includes(gameId)`. (red-team B2)

2. **Members tab — RESOLVED (user 2026-06-14): LINK, not embed.** `Member360View` is propless/route-
   coupled (red-team B1) → uid search box navigates to the existing `/dashboards/cs/members/:uid`.

3. **Care body — RESOLVED: extract `care-monitor-body.tsx`** (shared by CS page + Ops Care tab); compose-
   directly rejected (drops loading/error/empty states → not "identical"). Inactive tab unmounts to stop
   the 30s poll. (red-team B3)

4. **Promo card — RESOLVED (dropped).** `promo_charged_gross` = 0 (cfm) / negligible (jus). No promo-aware
   ARPU card this round; re-add only if promo data is populated upstream later.

5. **ROAS depth.** Ship **blended** ROAS (revenue_vnd_real ÷ spend; cfm ~15×, jus ~6.8×) + spend/CPC/CPM
   (all real) now; defer **cohort** ROAS/CPI/CAC (needs `mf_users.is_paid_install` + install-date join)?
   Recommendation: blended now, cohort deferred.

6. **Rollup reseal — Phase 2 A vs B.** Rely on bounded (≤31d) raw (correct, ~3.5–15s cold) or reseal
   full rollup history for speed? Decide from measured raw latency. (No correctness issue either way.)

7. **`cs_ticket_detail.closed_tickets` = 0 for cfm** — measure/status mapping bug? Affects the support
   card's open-vs-closed framing. Investigate before relying on closed/open counts (use total + unresolved
   meanwhile).

8. **jus gateway mix ~99.5% VNG** — keep the gateway-mix card for jus (one meaningful bar) or collapse to
   a single "VNG dominance" stat for jus? Recommendation: render the card but degrade gracefully.
   IMPLEMENTED: card renders gateways sorted by total; degrades to whatever rows exist (graceful for 1 bar).

---

## Implementation resolutions (2026-06-14 cook + code review)

- **#5 ROAS — RESOLVED differently.** `recharge.revenue_vnd_real` exists ONLY in cfm (verified absent from
  `cube-dev/cube/model/cubes/jus/recharge.yml`); using it would silently break jus ROAS (0.0×). Numerator
  is now the window's gateway VND cash (`billing_detail.cash_charged_gross`, already fetched, jus
  VND-filtered) for BOTH games — cfm's revenue_vnd_real reconciles to gateway cash; jus has no trustworthy
  recharge-revenue measure and `recharge.revenue_vnd` is banned. Cohort ROAS still deferred.
- **Query errors now surfaced** — `useOpsOverview` exposes `error`; Overview shows a banner instead of
  silent zeros when any measure fails (prevents a future cube rename reading as "₫0").
- **Game gate is `cfm_vn`/`jus_vn`** (real gds.config.json ids), not `cfm`/`jus` — the plan's `['cfm','jus']`
  would never match `useGameContext().gameId`.
- **#7 closed_tickets** — avoided entirely (Overview ships status-independent CS measures only).

## Still pending (need running app + cube — Phase 6 tail)
- Live `/load` verification of cfm_vn AND jus_vn Overview numbers against the audit.
- Playwright smoke (`/ops`, localStorage game seed, tab unmount, window toggle, zero console errors).
- Deploy to `second` (auto-deploys) — requires explicit user go-ahead.
