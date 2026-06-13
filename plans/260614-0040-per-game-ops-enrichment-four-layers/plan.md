---
title: "Per-Game Ops Enrichment — Four Cross-Cutting Data Layers (cfm + jus)"
description: "Add monetization, acquisition, identity/behavior, and CS-depth layers as game-scoped cubes, wired into views/catalog/segments/dashboards/care surfaces."
status: pending
priority: P2
effort: ~6d (cfm+jus only; template roll-out to 6 other games deferred)
branch: main
tags: [cube, enrichment, monetization, identity, cs, acquisition, freshness, per-game]
created: 2026-06-14
---

# Per-Game Ops Enrichment — Four Cross-Cutting Data Layers

Add FOUR cross-cutting data-model layers into the existing per-game Cube metrics so they
RESPECT the per-game filter automatically (cubes live in `cube-dev/cube/model/cubes/{cfm,jus}/`,
join to the game's `mf_users` spine), then wire them into consumer surfaces. Build/test cfm + jus
only this round; template must be roll-out-ready to the other 6 local games.

## Locked decisions (user-confirmed, verbatim — do NOT re-litigate)

1. **Games: cfm + jus ONLY this round** (live-data games). Template roll-out-ready to the other 6.
2. **Acquisition: best-effort, DEFER CAC cost.** Expose mf_users acquisition dims + channel→LTV
   views only. CAC spend cube + bundle_code↔game_id map do not exist in either repo → out of
   scope, follow-up plan.
3. **Surface depth: data models + exploration surfaces + consumer surfaces** — (a) new per-game
   cubes, (b) extend each game's `user_360` view, (c) members browsable in Playground/Catalog,
   (d) new segment dimensions, (e) dashboard cards, (f) Care-console / member360 hooks.
4. **Freshness: expose ALL layers but TAG each cube/member with a freshness tier in `description:`**
   so chat-agent + users know what is safe for live decisions vs historical exploration.

## Freshness-tier legend (governing constraint)

| Tier | Meaning | Source tables (cfm/jus) | UI use |
|------|---------|--------------------------|--------|
| `live` | current to yesterday | `billing.pmt_user_daily`, `gds_da.mf_ip2location`, mf_users-derived acquisition dims | live dashboards, alerting, segment gating |
| `lagging` | 1–4 mo behind | `vga.ingame_user_profile` (~2mo), `thinking_data.{game}__*` (~4mo), `cs_ticket*` (~3mo) | historical/exploration, triage; NOT live decisions |
| `archive` | >4 mo / frozen | `std_payment_details`, stale snapshots | do not use; reference only |

Every new cube `description:` MUST begin with one of: `[freshness: live]`, `[freshness: lagging]`,
`[freshness: archive]`. The chat-agent and Catalog surface this tag verbatim.

## Phases

| # | Phase | Status | Depends on | One-line |
|---|-------|--------|------------|----------|
| 1 | [Identity-bridge foundation](phase-01-identity-bridge-foundation.md) | pending | — | Trino-introspect + empirically resolve each cross-cutting table's join key to `mf_users.user_id` for cfm+jus; produce per-table bridge spec. |
| 2 | [Monetization / payer-360 cubes](phase-02-monetization-payer360-cubes.md) | pending | 1 | Port recharge/user_recharge_daily patterns + a `pmt_user_daily`-backed LIVE payer cube + lifetime payment history; payer LTV tiers + recency dims. |
| 3 | [Identity + behavior cubes](phase-03-identity-behavior-cubes.md) | pending | 1 | vga profile + `mf_ip2location` (LIVE geo) + thinking_data (lagging); geo-stability / churn-gap dims. |
| 4 | [CS depth cubes](phase-04-cs-depth-cubes.md) | pending | 1 | cs_ticket_info / cs_ticket_logs / cs_rating_processes; VIP routing + CSAT + support-volume-per-segment dims. |
| 5 | [Acquisition best-effort](phase-05-acquisition-best-effort.md) | pending | 1 | Expose mf_users acquisition dims + channel→LTV exploration views; explicitly DEFER CAC cost (document bundle_code blocker). |
| 6 | [View + catalog wiring + freshness](phase-06-view-catalog-freshness-wiring.md) | pending | 2,3,4,5 | Extend cfm/jus `user_360.yml`; confirm catalog auto-discovery; apply freshness-tier tags + meta in every description. |
| 7 | [Consumer surfaces](phase-07-consumer-surfaces.md) | pending | 6 | New segment dimensions, dashboard cards (design tokens — MANDATORY), Care-console/member360 hooks consuming new layers. |
| 8 | [Tests + pre-aggs + validation](phase-08-tests-preaggs-validation.md) | pending | 7 | vitest/playwright; CubeStore pre-aggs for big event tables w/ date-partition pruning; readiness + usedPreAggregations + freshness regression. |

## Key dependencies / ground truth (verified)

- **Per-game scoping is free:** cube in `cubes/{game}/` only compiles into that game's model
  (`cube-dev/cube/cube.js` `repositoryFactory`, per per-game-filter report §2). Cross-cutting tables
  MUST be filtered to the game (join to that game's `mf_users` OR a per-game product constant) — never leak rows.
- **`mf_users` is the join spine** (`cube-dev/cube/model/cubes/cfm/mf_users.yml:1-371`, jus :1-417),
  PK `user_id`, already carries acquisition + LTV + lifecycle dims.
- **Identity-bridge pattern to copy:** `cube-dev/cube/model/cubes/cfm/recharge.yml:42-63` LEFT JOINs a
  std bridge (vopenid→gds_user_id) before joining mf_users. Each new table has its own namespace hazard.
- **member-resolver** (`src/lib/cube-member-resolver.ts`, `server/src/services/cube-member-resolver.ts`)
  is passthrough on `local`; only matters on `prefix` (prod). New logical names auto-flow; never hardcode physical cube names in app code.
- **Catalog auto-discovers members** from Cube `/meta?extended=true` (`src/pages/Catalog/use-catalog-meta.ts:104`)
  — registering = make it compile + add `meta`/`description`. No catalog code change needed for browse.
- **segment-metric-registry is evidence-gated** (`server/src/lakehouse/segment-metric-registry.ts`) —
  only mart-backed metrics whose join probe PASSED get rows. New monetization marts add rows here.
- **Trino introspection:** `cube-dev/examples/trino_q.py` (REST client, env-configurable host/schema).

## Top risks

1. **Identity-bridge mismatch per table** (High×High) — each cross-cutting table uses a different id
   namespace; a wrong join silently zero-matches or fans out. Phase 1 gates everything; every bridge
   must be empirically probed against Trino (one-row-per-grain + match-rate) before any cube trusts it.
2. **Event-table scan blowup** (Med×High) — thinking_data (cfm 198M / jus 17.8M) + callback logs fan
   out and explode scans. Model at separate grain + mandatory date-partition pruning + CubeStore pre-aggs.
3. **Freshness leak into live UI** (Med×High) — a lagging cube (vga 2mo, cs 3mo) used in a live segment
   gate or dashboard alert produces wrong "current" decisions. Freshness tier in description + UI guard.

See [unresolved-questions.md](unresolved-questions.md) for build-gating open items carried from reports.
