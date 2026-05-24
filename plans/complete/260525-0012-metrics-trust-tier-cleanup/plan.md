---
title: "Metrics catalog trust+tier cleanup"
description: "Collapse trust tiers 5→3, auto-draft metrics with unresolved Cube refs, remove T1/T2/T3 from catalog, restyle trust filter chips to match metric-card chips."
status: completed
priority: P2
effort: "~5-7h (1 day)"
branch: "main"
tags: [catalog, metrics, trust, refactor]
blockedBy: []
blocks: []
related: [260524-2112-metric-catalog-expansion]
created: "2026-05-24T17:14:20.198Z"
createdBy: "ck:plan"
source: skill
slug: metrics-trust-tier-cleanup
---

# Metrics catalog trust+tier cleanup

## Overview

Today the metrics catalog exposes 5 trust tiers (`certified | beta | draft | deprecated | orphaned`) where `beta` and `orphaned` carry no distinct UX meaning, and a `tier: 1..6` field (T1/T2/T3) that adds visual noise without driving behavior. Worse, **45 of 57 presets reference Cube members that don't exist in the live `/cubejs-api/v1/meta` for ballistar** (including several marked `certified`) — so the trust badge actively lies about formula resolvability.

This plan ships a small, contained cleanup:

1. Collapse trust enum to `certified | draft | deprecated`. `beta`→`draft`, `orphaned`→`draft`.
2. Auto-flag metrics with unresolved formula refs as `draft` at API-response time (validator-driven, no YAML mutation).
3. **Hide `tier` from all user surfaces** — UI (metric card, list-row subtitle, filter rail) AND chat tools — but **keep the field on the data model** (Zod, YAMLs, FE types). The T1/T2/T3 curation signal stays available for future surfaces (Featured KPIs dashboard, starter-question ranking, watchlist priority); we just stop leaking it into surfaces where it adds noise without changing behavior.
4. Restyle the trust filter chip in `metrics-filter-rail` so it visually matches the `TrustBadge` chip on metric cards.

## Non-Goals

- Fixing the 45 broken metric refs themselves (separate effort; auto-draft just stops the lying).
- Adding back a "beta" promotion-path tier later (re-introduce only if release-gating becomes a real workflow).
- Migrating any DB rows (registry is file-based).
- **Deleting the `tier` field from the data model.** Tier is a curation signal (headline / working / specialist) the team already invested in across 57 metrics; we hide it but keep it for future use.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Enum + types collapse](./phase-01-enum-types-collapse.md) | Completed |
| 2 | [YAML sweep (trust + drop tier)](./phase-02-yaml-sweep-trust-drop-tier.md) | Completed |
| 3 | [Loader auto-draft on broken refs](./phase-03-loader-auto-draft-on-broken-refs.md) | Completed |
| 4 | [Tier UI removal](./phase-04-tier-ui-removal.md) | Completed |
| 5 | [Trust filter chip restyle](./phase-05-trust-filter-chip-restyle.md) | Completed |

## Success Criteria

- S1. `TRUST_TIERS` is `['certified','draft','deprecated']` in both server (`business-metric.ts`) and FE mirror; TypeScript compile is green across server + FE.
- S2. All 57 preset YAMLs have `trust ∈ {certified,draft,deprecated}`. `tier:` field preserved.
- S3. `GET /api/business-metrics?game=ballistar` returns `trust: 'draft'` for every preset whose formula refs don't resolve against the latest ballistar `/meta` — verified by reading the response for at least 3 known-broken IDs (`npu`, `installs`, `wau`) and 1 known-good (`paying_users`).
- S4. No `Tier N` strings or `TierBadge` renders remain on any user-facing surface: Catalog metric card, metric-list-row subtitle, metrics-filter-rail, metric-detail-header, and the `list_business_metrics` chat tool (arg removed from schema, `tier` stripped from the result payload). The `tier` value remains on the BusinessMetric type + Zod schema + YAMLs.
- S5. Trust filter chips in `metrics-filter-rail` render via the same `TrustBadge` component (or visually identical styling) used by metric cards.
- S6. `tsx server/src/scripts/check-metric-drift.ts` still runs and reports the same unresolved refs as before.
- S7. All existing `__tests__` updated; `npm run test` green.

## Dependencies

Related plan: `plans/260524-2112-metric-catalog-expansion/` introduced the `beta`/`draft` convention this plan supersedes. That plan shipped (registry at 57 presets) but its frontmatter says `pending` — not blocking, but the trust convention it documented is now obsolete.

## Outcome

All 5 phases completed. Test summary: FE 863/863 pass, server 182/182 pass, chat-service 210/210 pass. No regressions vs plan: trust tiers collapsed 5→3 (certified/draft/deprecated); 36 of 57 YAMLs rewritten (beta→draft); metric-trust-resolver.ts added (130 LOC, per-game cache, 60s TTL); tier hidden from all UI surfaces and chat tool while preserved on data model; trust filter chips restyled to match metric-card badges. TypeScript clean across all touched files.
