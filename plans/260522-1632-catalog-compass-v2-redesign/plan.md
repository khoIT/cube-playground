---
title: "Catalog — Compass v2 Redesign (Two-Layer Semantic Catalog)"
description: "Replace 2-tab Catalog (cube-browser + Schema) with 4-tab Catalog: Metrics (default, new biz-KPI registry) + Data Model (new concept-first grid) + Cubes (preserved) + Models (preserved). New ConceptDetail subsumes MetricCardPage. Two wizards. Right-rail Activation hook closes research-file Flow 5. Signals (Trust / Freshness) mocked v1. Anomaly + Drift + NL search + Digest in later phases. Lead-with-leadership phasing."
status: in-progress
priority: P1
branch: "main"
tags: [catalog, compass, semantic-layer, metrics, business-metrics, activation, ui, ia]
blockedBy: []
blocks: []
brainstorm: ../reports/brainstorm-260522-1632-catalog-compass-v2-redesign.md
mockup: ../reports/compass/Compass_v2/Compass.html
supersedes:
  - ../260520-2346-segments-first-class-redesign/phase-08-catalog-newmetric-game-aware-polish.md  # partial — full redesign here
created: "2026-05-22T09:41:14.722Z"
createdBy: "ck:plan"
source: skill
---

# Catalog — Compass v2 Redesign (Two-Layer Semantic Catalog)

## Overview

Replace the current 2-tab Catalog (cube-cluster browser + Schema) with a Compass-style **4-tab Catalog** centred on a **two-layer semantic architecture**:

- **Metrics tab (default)** — named business KPIs (DAU, ARPDAU, paying_users…) from a new `business-metrics/*.yml` registry. Consumer surface for leadership / liveops / analyst.
- **Data Model tab** — measures / dimensions / segments as concept-first cards (not cube-grouped). Author surface.
- **Cubes tab** — current cluster browser preserved as-is.
- **Models tab** — current SchemaPage preserved as-is.

A new `ConceptDetailPage` subsumes `MetricCardPage` and unifies all 4 concept kinds (measure / dim / segment / business-metric) under a shared 5-tab shell (Overview / Formula / Lineage / Slices / Activity). Right-rail "Push to activation" closes Flow 5 from the research file. Two wizards (current rebranded as "New building block" + new Metric Composition wizard). Trust / Freshness signals mocked v1 from YAML + `refresh_key`; Anomaly + Drift deferred to P8.

**Audience:** leadership / liveops (consumer surface) → P1–P4 = demoable core. Cut after P4 if scope pressure arrives.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Shell and routing](./phase-01-shell-and-routing.md) | Done (2026-05-23) |
| 2 | [Business metrics registry and backend wire](./phase-02-business-metrics-registry-and-backend-wire.md) | Done (2026-05-23) |
| 3 | [Metrics tab and detail page](./phase-03-metrics-tab-and-detail-page.md) | Done (2026-05-23) |
| 4 | [Demo value loop (activation + anomaly + lineage)](./phase-04-demo-value-loop-activation-anomaly-lineage.md) | Done (2026-05-23) |
| 5 | [Data Model tab and concept detail](./phase-05-data-model-tab-and-concept-detail.md) | Done (2026-05-23) |
| 6 | [Wizards rebrand and composition](./phase-06-wizards-rebrand-and-composition.md) | Pending |
| 7 | [Smart search overlay](./phase-07-smart-search-overlay.md) | Pending |
| 8 | [Signal upgrades (freshness + trust + anomaly)](./phase-08-signal-upgrades-freshness-trust-anomaly.md) | Pending |
| 9 | [Long tail (digest + saved views + workspaces)](./phase-09-long-tail-digest-saved-views-workspaces.md) | Pending |

## Dependency graph

```
P1 (Shell) ──┬──> P2 (Registry) ──> P3 (Metrics tab + Detail) ──> P4 (Demo loop)
             │                                  │
             └───────────────────────────────> P5 (Data Model + ConceptDetail)
                                                │
                                          ┌─────┴─────┐
                                          v           v
                                       P6 Wizards    P7 ⌘K  P8 Signals  P9 Long-tail
```

## Demoable core

**P1 + P2 + P3 + P4 = leadership demo ready.** Run research-file demo order (Flow 5 → Flow 3 → Flow 4 → Flow 1/2) end-to-end from the new Metrics tab. If scope pressure arrives, cut here.

## Key constraints (from brainstorm + revisions 2026-05-22 18:52 + 19:11)

- `business-metrics/` registry lives in **cube-playground's existing Fastify sidecar** at `server/src/presets/business-metrics/*.yml`. cube-dev stays as sealed Cube.js docker image.
- Custom endpoints (business-metrics + future anomaly-state + future agent proxy) extend `server/src/routes/`.
- **Schema is per-game (6 games: ballistar/cfm/jus/ptg/muaw/pubg) — driven by Cube `repositoryFactory` keyed off `securityContext.game` JWT claim.** Cube *names* are stable across games (`recharge`, `mf_users`, …); SQL underneath diverges. Game-Context picker already wired (`useActiveGameId()` from completed plan 260520).
- **PTG and MUAW have only `recharge`** — no `mf_users`, no `std_ingame_user_active_daily`, no `std_*`, no `cons_*`. Business metrics that depend on missing tables must be tagged `game_compatibility:` and rendered as disabled / "Not available for <game>" cards when active game lacks the upstream.
- Per-game data freshness diverges (PTG ~3 weeks stale at introspection — see `cube-dev/plans/reports/introspection-260522-1747-game-integration-schema-diff.md`).
- `cdp-projection` folds into Slices-tab section + filter chip (R3).
- No cube-rename support v1 (R7).
- Two wizards share a `WizardShell` extracted in P6 (R4).
- Compass v2 mockup is **spec, not source** — rewrite in TS/React per phase (R6).

## Dependencies (cross-plan)

- **Wires into** `260520-2346-segments-first-class-redesign/phase-07-push-modal-activate-to-cdp.md` (completed) — P4 right-rail Activation hook calls existing push-modal.
- **Reads from** `260519-1610-query-results-to-segments` segment registry (completed) — P5 shows segments as concept cards.
- **Supersedes (partial)** `260520-2346-segments-first-class-redesign/phase-08-catalog-newmetric-game-aware-polish.md` — that phase was Partial; this plan is the full Catalog redesign.

## Risks (carried from brainstorm)

- **R1** — ~~Backend endpoint for `business-metrics/` not yet planned~~ **RESOLVED 2026-05-22 18:52:** registry + endpoint live in cube-playground's existing Fastify sidecar at `server/src/presets/business-metrics/` + `server/src/routes/business-metrics.ts`. cube-dev unchanged.
- **R9** (NEW 2026-05-22 19:11) — **Per-game schema coverage diverges.** PTG/MUAW lack mf_users + std_* tables; metrics referencing those will fail. **Mitigation:** `game_compatibility:` field in business-metric YAML; frontend filters / disables incompatible cards via `useActiveGameId()`. Open Qs 1–10 in `cube-dev/plans/reports/introspection-260522-1747-game-integration-schema-diff.md` are data-semantics questions feeding metric formula authoring (P5/P6 wizard) — not catalog-UI blockers.
- **R2** — `MetricCard` measure-only coupling — don't reuse shell; rehome content modules only
- **R3** — `cdp-projection` rehoming (P5)
- **R4** — Two wizards diverging UX — extract shared `WizardShell` (P6)
- **R5** — Trust seeding noise — default to `beta`, not `draft`
- **R6** — Compass mockup uses Babel-in-browser — spec only, full rewrite per phase
- **R7** — Concept FQN in URL = stale-link if cube renamed — accepted, out of scope
- **R8** — P3 is heaviest; may further split during cook

## Open questions (carried from brainstorm)

1. ~~Backend wire for `business-metrics/`~~ **RESOLVED:** extend cube-playground Fastify server; YAML in `server/src/presets/business-metrics/`.
2. Inline-edit vs toggle-edit on detail pages (Compass Tweak §10.3) — pick default in P3
3. Trust badge prominence (Compass Tweak §10.4) — default = medium
4. Sparkline data source — live Cube query vs precomputed snapshot — P3 perf budget
5. Lineage v2 authoring — wizard Step 1 (P6) vs dedicated affordance later
6. ~~Anomaly detector hosting (P8) — inside cube-dev vs alongside Monet~~ **RESOLVED:** scheduled job inside cube-playground server (`server/src/jobs/anomaly-detector.ts`). Same runtime as refresh-log cron.
7. GDS-1.8 import banner trigger threshold — P3 detail
