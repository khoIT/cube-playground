---
title: "Meta-Driven Product Surfaces (POC) — CANCELLED, absorbed into wizard v2 plan"
description: "Cancelled 2026-05-16. All 5 phases (extended-meta foundation, wizard meta surfaces, sidebar enrichment, /catalog browse view, pre-aggregation badge) rolled into the merged plan 260516-1940-new-metric-wizard-v2-and-meta-driven-surfaces to avoid file-edit conflicts on shared wizard + sidebar surfaces."
status: cancelled
priority: P2
branch: "main"
tags: [feature, meta, catalog, wizard, poc-demo, cancelled, absorbed]
blockedBy: []
blocks: []
supersededBy: "260516-1940-new-metric-wizard-v2-and-meta-driven-surfaces"
created: "2026-05-16T11:55:33.627Z"
createdBy: "ck:plan"
source: skill
---

> **CANCELLED 2026-05-16.** All scope absorbed into [`../260516-1940-new-metric-wizard-v2-and-meta-driven-surfaces/plan.md`](../260516-1940-new-metric-wizard-v2-and-meta-driven-surfaces/plan.md). Reason: shared file-edit surface with the wizard v2 redesign — shipping them as separate plans would have created merge pain on `NewMetricDialog.tsx`, `schema-write-handler.ts`, the sidebar measure list, and the YAML generator. The merged plan preserves all 5 surfaces (extended meta + wizard meta + sidebar enrichment + /catalog + pre-agg badge) as phases 1, 4, 6, 7, 8.


# Meta-Driven Product Surfaces (POC)

## Overview

Take the rich content `/cubejs-api/v1/meta?extended=true` already exposes — `description`, `aggType`, `formatDescription`, `connectedComponent`, `joins[]`, `primaryKey`, `public:false` — and surface it across four product layers of cube-playground. Replaces the cancelled `260516-1521-metadata-catalog-tab` (which depended on the unavailable `/cubejs-system/v1/meta` and on `meta.*`/`measure.sql` fields that are empty / never exposed).

Anchored to the ballistar_vn schema (4 cubes + 7 views) per leadership confirmation. POC-grade: fully shipped in dev + prod builds, no special guards, no new env vars, wizard provenance hardcoded to `author: khoitn`.

Pivotal upstream finding: `cubeApi.meta()` (SDK) calls `/cubejs-api/v1/meta` WITHOUT `extended=true`, which strips `joins[]`. The wizard's `useReachableMembers` reads `cube.joins` and silently returns an empty graph — Phase 1 unblocks this and every dependent surface.

**Source brainstorm:** [`../reports/metadata-catalog-tab-system-meta.md`](../reports/metadata-catalog-tab-system-meta.md) (the cancelled plan — kept as historical record of the over-scoped design).
**Architecture refs:** [`../reports/architecture/cube-vs-cdp-metrics-architecture.md`](../reports/architecture/cube-vs-cdp-metrics-architecture.md), [`../reports/architecture/cube-mm01-integration-and-schema-reload.md`](../reports/architecture/cube-mm01-integration-and-schema-reload.md), [`../reports/architecture/poc-scoping-and-leadership-decisions.md`](../reports/architecture/poc-scoping-and-leadership-decisions.md).

## Demo Storyboard — what the user will see on the cube-playground UI

The plan delivers five visible surfaces, sequenced for a single end-to-end demo run:

### 1. Sidebar tooltip — every measure carries its meta (P3)

In the QueryBuilder Playground page, hovering any measure in the left sidebar reveals a tooltip that today shows only `type/name/title`. After P3 it also shows: **description**, **aggregation type chip** (`≈ Cnt-D`, `Σ`, `Cnt`, `ƒx`), and **format hint** (`Currency · VND`, `Number · ,.2~f`). Description previously dropped at the call site (`ListMember.tsx:111`) — now wired through. Demo line: *"You already see `dau` in the sidebar. Hover it — now you see what it actually does, the agg type, and the format. No code to read, no docs to chase."*

### 2. Sidebar cube card — cluster badge (P3)

Each cube card in the sidebar gets a small chip in its header: **"Joins to 3 cubes"** (for the 4 cubes in the connected hub-spoke cluster) or **"Standalone"** (for the 7 views with no joins). Reads from `cube.connectedComponent` exposed via the Phase 1 extended fetch. Demo line: *"Before you start a query, you can tell at a glance which cubes you can blend together and which stand alone."*

### 3. Wizard sections — find-similar warning (P2)

Inside the existing **✱ New metric** wizard, between the Operation and Of sections, a new collapsible warning surfaces when the draft pattern matches existing measures: **"4 existing measures use countDistinctApprox on this cube — `active_daily.dau` (Daily active users HLL approx_distinct), `active_daily.mau`, `active_daily.mau_prev_month`, `active_daily.active_servers`. Open one?"** Soft signal: doesn't block intentional duplication, just nudges. Match strategy: `aggType + sourceCube`. The plan considered narrowing on `ofMember` column reference too, but `measure.sql` is 0/59 populated on `/cubejs-api/v1/meta` (security-stripped by Cube design), so the column-overlap check is impossible. Loose match is acceptable for the ballistar_vn schema scale (worst case 4 peers per aggType per cube). Demo line: *"Before you save a new metric, the wizard tells you when it probably already exists."*

### 4. Wizard YAML — provenance stamp (P2)

Every wizard-authored measure now emits a `meta:` block in the YAML:
```yaml
- name: my_new_metric
  type: count
  sql: "{active_daily}.user_id"
  meta:
    source: wizard
    author: khoitn
    created_at: 2026-05-16T17:30:00Z
```
Visible in the wizard's YAML preview, persisted to `model/*.yml`, and shows up in `/meta` after the auto-refetch. Foundation for future Tier-2 filtering ("show me wizard-authored measures") and MM-01 sync provenance per `cube-vs-cdp-metrics-architecture.md` §3.3.

### 5. /catalog browse view — the demo centerpiece (P4)

New top-level **Catalog** nav pill (third pill, after Models). Click → `/catalog` route. Page renders:

```
┌───────────────────────────────────────────────────────────────────┐
│ Header pills [Playground] [Models] [Catalog]                      │
├──────────┬────────────────────────────────────────────────────────┤
│ Filter   │ ┌─ Search across name/title/description ────────────┐ │
│  - type  │ └────────────────────────────────────────────────────┘ │
│  - agg   │                                                          │
│  - has   │ Cluster: Connected ─ mf_users + 3 spokes ───────────────│
│    desc  │  ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│  - clust │  │active_daily│ │ mf_users   │ │ recharge   │           │
│          │  │ description│ │ description│ │ description│           │
│          │  │ ≈Cnt-D×4 Σ×2│ │ Cnt×3 Σ×1 │ │ Cnt×2 Σ×3│           │
│          │  └────────────┘ └────────────┘ └────────────┘           │
│          │  ┌────────────┐                                          │
│          │  │user_recharg│                                          │
│          │  │_daily      │                                          │
│          │  └────────────┘                                          │
│          │                                                          │
│          │ Cluster: Standalone views (7) ──────────────────────────│
│          │  ┌────────────┐ ┌────────────┐ ...                       │
│          │  │user_profile│ │timeline    │                          │
│          │  └────────────┘ └────────────┘                          │
└──────────┴────────────────────────────────────────────────────────┘
```

Click a card → in-page **DetailPanel** with description, joins table (using extended payload), all measures (name + aggType chip + format hint + description + wizard-author chip if `meta.source=wizard`), all dimensions (type + PK flag + hidden flag), and an **Open in Playground** deep-link button that sets the QueryBuilder source cube.

Facets only include fields the live `/meta` actually populates:
- `type` (cube vs view, 11/11)
- `aggType` filter (filters measures cross-cube, 59/59)
- `has description` toggle (boolean, 21/59 for measures)
- `cluster` group (4 cubes in `connectedComponent=1`, 7 standalone views)

No SQL snippet section, no Tier-2 adaptive `meta.*` facets (zero across the schema today; will populate organically as wizard-authored measures accumulate).

### 6. Pre-aggregation badge (P5)

After enabling `pre_aggregations:` in `cube-dev/cube/model/cubes/mf_users.yml`, the catalog surfaces a **"Has rollup × N"** badge on cube cards and a "Pre-aggregated" filter chip. Detail panel shows pre-agg names and time-dimension granularity. Demo line: *"This cube has a daily rollup — queries hitting `dau` by day are millisecond-class."*

---

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Foundation: extended /meta + reachability fix](./phase-01-foundation-extended-meta-reachability-fix.md) | Pending |
| 2 | [Wizard meta surfaces: provenance + find-similar](./phase-02-wizard-meta-surfaces-provenance-find-similar.md) | Pending |
| 3 | [Sidebar member enrichment: tooltip aggType/format/cluster badge](./phase-03-sidebar-member-enrichment-tooltip-aggtype-format-cluster-bad.md) | Pending |
| 4 | [Catalog browse view: standalone /catalog route](./phase-04-catalog-browse-view-standalone-catalog-route.md) | Pending |
| 5 | [Pre-aggregation enablement + catalog badge](./phase-05-pre-aggregation-enablement-catalog-badge.md) | Pending |

## Sequence

```
P1 (gate) ──┬─▶ P2 (wizard provenance + find-similar)
            ├─▶ P3 (sidebar tooltip + cluster badge)
            └─▶ P4 (catalog) ──▶ P5 (pre-agg + badge)

P2 & P3 parallelizable after P1 lands.
P4 depends on P1 (extended meta), can start once P1 is on main.
P5 depends on P4 (badge surface) AND cube-dev YAML edit.
```

## Key Decisions (locked)

- **Endpoint:** `/cubejs-api/v1/meta?extended=true` ONLY. No `/cubejs-system/*`, no env-baked secret. Reuses existing `AppContext.cubejsToken`.
- **Auth posture:** identical to QueryBuilder. No new surface, no PROD guard, no `jose`.
- **Provenance author:** hardcoded `khoitn` (POC). Wire to a real source later.
- **Wizard backfill:** wizard-only `meta:` emission. Hand-authored YAML is NOT retroactively stamped. Auto-reload on save already works (`AppContext.refreshMeta`).
- **`/catalog` route:** fully shipped, no dev-only guard.
- **POC scope:** demo-grade. Verification gates skipped where the failure mode is cosmetic.

## Total Effort

≈ 5–6 focused days. Calendar 1.5–2 weeks.

| Phase | Effort | Priority |
|-------|--------|----------|
| P1 | 0.5d | P0 (gate) |
| P2 | 1d   | P1 |
| P3 | 0.5d | P1 |
| P4 | 2–3d | P2 |
| P5 | 1d   | P2 |

## Dependencies

No cross-plan blockers. Supersedes (does NOT revive) `260516-1521-metadata-catalog-tab` — different scope, different auth model, different premise.

P5 touches `cube-dev/cube/model/cubes/mf_users.yml` in the cube-dev repo — coordinate that PR separately.

## Out of Scope (v1)

- Backfilling `meta:` provenance on hand-authored measures (decided wizard-only per leadership)
- Lineage view (cube → upstream tables) — needs YAML read access not in `/meta`
- Hidden-member discovery beyond PK dimensions
- Tier-2 adaptive `meta.*` facets — only useful after schema accumulates `meta:` blocks (deferred)
- SQL snippet display per measure — `/cubejs-api/v1/meta` never exposes this; only `/cubejs-system/v1/meta` would (and that endpoint isn't deployed)
- Hygiene "docs coverage %" leaderboard — optional polish, deferred
- Catalog virtualisation / scale beyond ~50 cubes
- Multi-game scope (per `poc-scoping-and-leadership-decisions.md` §7.4 — still single-game `ballistar_vn`)

## Open Questions

1. Does `?extended=true` reliably populate `preAggregations` in `/meta` on this Cube version, or only `joins[]`? Re-probe at start of P5; spec is unclear.
2. Should the find-similar warning (P2) consider cross-cube measures, or limit to same source cube? Default: same source cube (less noise; demo-clearer).
3. Catalog DetailPanel "Open in Playground" — should it just set source cube, or pre-select first measure too? Default: source cube only; user picks from there.

## Validation Log

### Session 1 — 2026-05-16

**Decisions confirmed:**

1. **Phase 1 auth plumbing for raw `/meta?extended=true` fetch** — Source `apiUrl` and `token` via `useContext(AppContext)` directly inside `useQueryBuilder`. Both fields are already exposed on `ContextProps` (`src/components/AppContext.tsx:36-39`) and are the same values the SDK factory at `src/hooks/cubejs-api.ts:10` consumes. No new hook props, no SDK transport reach-in. **Propagated to:** Phase 1, step 2.
2. **Phase 5 scope** — Keep the cube-dev `pre_aggregations:` YAML edit inside this plan. POC posture; the demo arc needs the rollup badge for a wow-moment. Cross-repo coordination flagged in P5 todo list, not deferred. **Propagated to:** no change required (already in P5).
3. **Phase 4 Header surface** — Add `Catalog` to BOTH the desktop `<PillRow>` (line 70-86) AND the mobile `<Menu>` dropdown (line 90-107) in `src/components/Header/Header.tsx`. Initial spec only mentioned the desktop pill. **Propagated to:** Phase 4, step 4.1.2.
4. **Phase 2 find-similar ranking** — Sort matches by `description`-present first, then alphabetical by `measureName`. Surfaces documented peers (high-trust signal) at top. **Propagated to:** Phase 2, step 7.

### Verification Results

- Tier: Full (5 phases → all 4 roles)
- Claims checked: 17 cited file paths + line numbers across 5 phases
- Verified: 17 | Failed: 0 | Unverified: 0
- Notable verified references:
  - `loadMeta()` at `src/QueryBuilderV2/hooks/query-builder.ts:322` (Fact Checker)
  - `selectCube` defined at `query-builder.ts:1417` (Fact Checker)
  - `joinableCubes` already uses `cube.connectedComponent` at `query-builder.ts:1106` with `@ts-ignore` (Flow Tracer — confirms connectedComponent is exposed without `extended=true`; only `joins[]` requires the flag)
  - `cubejs(token, { apiUrl })` factory at `src/hooks/cubejs-api.ts:10` (Flow Tracer — anchors AppContext-as-source-of-truth decision)
  - `ListMember.tsx:111` does NOT pass `description` to `InstanceTooltipProvider` (Fact Checker — confirms P3 gap)
  - `Header.tsx` has 2 nav surfaces: desktop PillRow + mobile Menu (Contract Verifier — surfaced missing mobile update)

### Whole-Plan Consistency Sweep

Re-read `plan.md` + all 5 phase files after propagation. Decision deltas checked: 4. Reconciled stale references: 0. Unresolved contradictions: 0.

- Phase 1 auth plumbing decision propagated; matches Foundation requirements section.
- Phase 4 mobile dropdown step added; matches the "fully shipped" posture (both viewports).
- Phase 2 ranking decision aligns with the storyboard line (`description-present first`).
- Find-similar match strategy (aggType+sourceCube only, no `m.sql` overlap) consistent between plan.md storyboard and Phase 2 step 7 — fixed in earlier consistency sweep prior to validation.
- No duplicate embedded YAML drafts or contracts to reconcile.

Whole-plan consistency: **clean**.
