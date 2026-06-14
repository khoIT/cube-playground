---
title: "Ops Console — Per-Game 360 page (/ops) [Placement 2]"
description: "New top-level /ops page giving a full payment + users 360 for a game, built on the four ops data layers. Three tabs: Overview (window-aware aggregate), Members (reuse member360), Care (reuse playbook monitor). cfm/jus only."
status: pending
priority: P2
effort: ~3-4d
branch: main
blockedBy: [260614-0040-per-game-ops-enrichment-four-layers]
tags: [ops, console, dashboard, monetization, member360, care, cfm, jus, window]
created: 2026-06-14
---

# Ops Console — Per-Game 360 (/ops) · Placement 2

A dedicated top-level `/ops` page that answers "what is going on in this game, payment + users"
in one place. It is the consumer surface for the four ops data layers built in
[260614-0040-per-game-ops-enrichment-four-layers](../260614-0040-per-game-ops-enrichment-four-layers/plan.md)
(`billing_detail`, `billing_lifetime`, `cs_ticket_detail`, `user_identity`, plus existing
`marketing_cost` / `user_recharge_daily` / `mf_users`). It completes that plan's Phase-7 "dashboard
cards" remainder, but as a focused console rather than scattered cards.

Mockup (approved direction): `../260614-0040-per-game-ops-enrichment-four-layers/visuals/ops-console-overview.html`
+ `ops-placement-variants.html`.

## Shape

Three tabs under one cfm/jus-gated page:

| Tab | Build | Source |
|-----|-------|--------|
| **Overview** | NEW — window-aware (7d / 30d / MTD) aggregate cards + trend charts | aggregate Cube queries (no user filter) over the ops cubes |
| **Members** | LINK — uid search box → navigates to the existing `/dashboards/cs/members/:uid` route (NOT embedded) | existing route; `Member360View` is propless/route-coupled so it is linked, not embedded (red-team B1) |
| **Care** | EMBED — the VIP-care playbook monitor, via an extracted shared body | `PortfolioStrip` + `PlaybookGrid` + `CsActivityStrip` lifted into `care-monitor-body.tsx` (`src/pages/Dashboards/cs/`) |

The Overview is the only net-new data surface. Care is embedded (shared-body extraction); Members is a
uid search + link to the already-routable member360 (user decision 2026-06-14: "Members link, Care embedded").

## Locked decisions (user-confirmed, verbatim — do NOT re-litigate)

1. **Placement 2** — a dedicated `/ops` page (not a strip folded into Dashboards/cs).
2. **Members link + Care embedded** (refined 2026-06-14 after red-team) — original "fold in both tabs"
   amended: Member360View is propless/route-coupled (can't embed without a refactor) → Members is a uid
   search + link to the existing member360 route; Care monitor IS embedded via a shared-body extraction.
3. **Window-aware** — Overview observable over 7d / 30d windows (MTD bonus). User: "these data
   would be truly helpful if we can observe over a window of 7 or 30d." **Δ-vs-prior = 7d only** (no
   data before ~mid-May → 30d Δ impossible; snapshots can't Δ). Window toggle re-scopes values + trends.
4. **cfm + jus only** — same games the data layers cover.

## Window semantics

The window toggle (7d / 30d / MTD) re-scopes additive Overview tiles + the trend charts. **Δ-vs-prior is
shown ONLY on the 7d window** (prior 7d exists within the ~30d of billing history; 30d has no prior data;
snapshot cards never show Δ). Default = 30d. Trends: cash daily, payers-vs-cash (divergence),
gateway-mix-over-time (stacked) — all real (audit 2026-06-14). Money uses
`billing_detail.cash_charged_gross` (cfm; jus filtered `currency='VND'`) or `recharge.revenue_vnd_real`
— NEVER `recharge.revenue_vnd` (~9× inflated ingame units). **`paying_users`/distinct measures are
queried once over the whole window (no day-granularity sum — they are non-additive).**

## Data reality (audited 2026-06-14 — see reports/data-reality-audit-260614-cfm-jus-report.md)

Built ONLY on verified-populated measures. Real: cash/txns/payers + daily trends, gateway mix, support
health (cs_ticket_detail, ~2d lag), lifetime reconciliation (`billing_lifetime` ₫508B vs `mf_users` LTV
₫358B = +42%), cross-border (`mf_users.geo_moved` — movers 18×/30× richer than base for cfm/jus),
acquisition spend + CPC + blended ROAS (`marketing_cost`). DROPPED as not-real: promo-aware ARPU
(`promo_charged_gross`=0), store card (1:1 with gateway), item_type (single value). geo source is
`mf_users`, NOT the thin `user_identity` cube.

## Phases

| # | Phase | Status | Depends on | One-line |
|---|-------|--------|------------|----------|
| 1 | [Page scaffold + routing + gating + tab shell](phase-01-scaffold-routing-gating.md) | ✅ done | — | `/ops` route + sidebar nav + **cfm_vn/jus_vn** gate + 3-tab IA + window-toggle + `?tab=` deeplink + inactive-tab unmount |
| 2 | [Rollup history reseal (perf)](phase-02-rollup-store-method-dim-fix.md) | ⏸ deferred | — | NOT a prerequisite — bounded (≤31d) raw is correct (raw==rollup per day, audited). Overview uses bounded raw. Reseal = pure perf; revisit only if cold-query latency hurts. Infra change (cube YAML + restart + reseal, auto-deploys) → separate push |
| 3 | [Overview tab — cards + trends](phase-03-overview-cards-trends.md) | ✅ done | 1 | Window-aware Overview: hero cards + 7d-only Δ, 3 trend charts, real-only panels (gateway mix, support health, lifetime reconciliation, cross-border geo_moved, acquisition + blended ROAS). ROAS numerator = gateway VND cash (both games; jus has no revenue_vnd_real). Aggregate-only → no PII. Error banner on query failure |
| 4 | [Members tab — uid search + link](phase-04-members-tab-reuse.md) | ✅ done | 1 | uid search box → navigate to existing `/dashboards/cs/members/:uid?game=` (encoded uid for vopenid) |
| 5 | [Care tab — embed via shared body](phase-05-care-tab-reuse.md) | ✅ done | 1 | Extracted presentational `care-monitor-body.tsx` (CS hooks not deduped → each call site owns its fetch, no double-fetch/regression); rendered in CS page AND Care tab; inactive tabs unmount |
| 6 | [Tests + validation + deploy](phase-06-tests-validation-deploy.md) | 🔶 partial | 3,5 | DONE: vitest window/7d-Δ math + aggregate/PII contract (exported query objects) + format; full suite 2405 pass; vite build OK; tsc 0 new errors. PENDING (needs running app/cube): cfm_vn+jus_vn live /load verify, playwright smoke, deploy |

## Key dependencies / ground truth (verified by scout 2026-06-14)

- **Route registration:** `src/index.tsx` (loadable page + `<Route>`); sidebar `src/shell/sidebar/sidebar.tsx`
  (`<SidebarSection>` + `showSection()` gate).
- **Game context:** `src/components/Header/use-game-context.ts` — `useGameContext()` / `useActiveGameId()`;
  availability narrowed by workspace grant + cube schema readiness. Restrict page render to `['cfm','jus']`.
- **Member360 reuse:** `src/pages/Segments/member360/member-360-view.tsx` (`Member360View`), panel registry
  `member360-panels.ts` (per-game, `section: core|behavior|ops`), care-first `cs-member360-view.tsx`
  (`CsMember360View`, props `{gameId, uid, sections, row, profileLoading, cachedSource}`). uid may contain
  `@` (vopenid) → URL-decode.
- **Care reuse:** `src/pages/Dashboards/cs/index.tsx` composes `PortfolioStrip` + `PlaybookGrid` +
  `CsActivityStrip`; data via `useCarePlaybooks(gameId)` + `useCareDataFreshness(gameId)`.
- **Cube query hook:** `src/pages/Segments/member360/use-member-cube-query.ts` (`useMemberCubeQuery(gameId, query)`,
  concurrency semaphore); SDK factory `src/hooks/cubejs-api.ts` (`useCubejsApi`, injects `x-cube-workspace` /
  `x-cube-game`). Use `/cube-api` workspace-aware proxy.
- **StatCard idiom:** `src/pages/Dashboards/cs/portfolio-strip.tsx:34-75` — not exported; promote to a shared
  card component OR copy verbatim. Tokens only (`--bg-card`, `--border-card`, `--radius-xl`, `--shadow-sm`).
- **billing_detail rollup gap:** `cube-dev/cube/model/cubes/cfm/billing_detail.yml:186-212` — rollup
  `billing_detail_daily_batch` dims = `currency, payment_gateway, promotion_type` only. `store` +
  `payment_method_id` ABSENT → queries grouping by them fall through `union_with_source_data:true` to the
  58.6M raw source and double-count (~3×). Phase 2 fixes. Mirror in jus.
- **Pre-agg routing read by COMPILED SQL** (`server/src/services/preagg-readiness.ts:15-21`) — lambda unions
  mask `usedPreAggregations`. Verify routing by the FROM clause, never that field (parent plan red-team #7).
- **DEV_MODE=false ⇒ no hot reload** — restart `cube-playground-cube-api-dev` after rollup YAML change to
  load + reseal (parent plan key-deps; memory `cube-serving-instance-needs-restart-for-new-rollups`).

## Design system (MANDATORY)

Read `docs/design-guidelines.md`. Page-header pattern fixed: `padding:'24px 32px'`, centered `maxWidth`
(1200–1400 for grids), icon + 20px/700 title, optional uppercase eyebrow. Tokens only — mirror
`src/pages/Dashboards/cs/index.tsx` and `src/pages/Liveops/cohort/index.tsx`. Cross-check against an
adjacent existing page before shipping (drift = bug).

## Top risks

1. **Rollup history gap (NOT double-count)** (Med×Med) — AUDITED: raw == rollup per day (no fan-out).
   The real issue is the `billing_detail` rollup only has June sealed, so a 30d window crossing into May
   falls to raw. Mitigation: bounded (≤31d) raw queries are CORRECT and fast enough, or reseal history
   (Phase 2). Phase 3 does NOT block on Phase 2. Money measure must be `cash_charged_gross` /
   `revenue_vnd_real`, never `recharge.revenue_vnd` (9× inflated units).
2. **PII via aggregate page** (Low — by design) — Overview issues aggregate queries WITHOUT a user_id
   filter, so it returns no per-user rows → no PII surface. Members tab reuses the already-redacted
   member360 path. Phase 6 asserts Overview queries carry no PII dims.
3. **Promo measures empty → card DROPPED** (resolved by audit) — `promo_charged_gross` = 0 (cfm) /
   negligible (jus). No promo-aware ARPU card this round (was fabricated in the mockup). Re-add only if
   promo data is populated upstream later.
4. **Game-gating bypass** (Med) — a non-cfm/jus game must not see a half-empty /ops. Gate at render
   (return an "ops not available for {game}" state) AND hide the sidebar item via `showSection`.
5. **Reused component coupling** (resolved by red-team) — `Member360View` is propless/route-coupled →
   Members is a LINK, not an embed (no refactor). Care is embedded via a `care-monitor-body.tsx`
   extraction (shared with the live CS page); inactive tabs must unmount to stop the 30s activity poll.

## Red Team Review (2 reviewers, 2026-06-14 — see reports/red-team-260614-ops-console-two-reviewer-report.md)

18 findings (5 Crit). Applied to phases. Highest-impact:
- **A1** `paying_users` non-additive → headline = single ungrouped windowed query, never sum daily (phase-03, phase-06 test).
- **A2** jus billing_detail is **mixed USD+VND** → jus money filters `currency='VND'` or uses `revenue_vnd_real`; cfm VND-safe (phase-03).
- **A3/A4** recon "+42%" is an apples-to-oranges structural wedge (vs cube's ~1.78× note) AND a snapshot → reframed, demoted, **no window/Δ** (phase-03).
- **A5** `geo_moved` = first≠last login country (travel/VPN/sharing proxy, not residence); "Nx richer" = selection bias → relabel, count+LTV only (phase-03).
- **A6** `closed_tickets`=0 (broken status predicate) → ship status-independent CS measures only; relabel unresolved-member as "unmapped (FB)" (phase-03).
- **B1** `Member360View` propless/route-coupled → Members = link (user-confirmed); **B2** `showSection('ops')` won't compile (closed unions) → nav under existing `dashboards` section, no new feature key (phase-01).
- **B4** gameId ready-race (defaults `'ballistar'`) → gate on `ready` before firing Overview queries (phase-01, phase-03).
- **Data-forced:** no billing data before ~mid-May → 30d Δ impossible → **Δ shown on 7d only** (user-confirmed).

## Open questions

See [unresolved-questions.md](unresolved-questions.md).
