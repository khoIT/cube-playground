---
title: "Metric Card — Routable Measure Detail Wired to Catalog"
description: "Single-measure detail surface at /metric/:cubeName.:memberName. Reuses useCatalogMeta() (already fetches ?extended=true) and renders a /meta-derived card with description, aggType, format, provenance, joinable-with, similar-measures, how-to-slice, and a Try-it deep-link to Builder. MeasureRow in the existing Catalog DetailPanel becomes the entry point. Standalone URL makes any measure shareable, bookmarkable, and Slack-pasteable."
status: completed
priority: P2
branch: "multi_metric"
tags: [feature, catalog, metric-card, meta, routable, poc-demo]
blockedBy: []
blocks: []
created: "2026-05-16T22:58:43.822Z"
createdBy: "ck:plan"
source: skill
---

# Metric Card — Routable Measure Detail Wired to Catalog

## Overview

Turn every measure into a first-class, linkable object. New route `/metric/:cubeName.:memberName` mounts a `MetricCardPage` that reuses the existing `useCatalogMeta()` hook (which already fetches `/cubejs-api/v1/meta?extended=true`) and renders a single-purpose detail card driven entirely by `/meta` content.

The card is **composed**, not invented: every section is derived from `CatalogCube + CatalogMeasure` fields already typed in `src/pages/Catalog/use-catalog-meta.ts`. No new endpoint, no new auth, no env var. The existing Catalog `DetailPanel` (cube-focused) stays unchanged; `MeasureRow` becomes the navigation entry into the card, replacing the current inline-expand pattern when the cube has CDP projection (or augmenting it — decided in Phase 2).

The card's value is **shareability + completeness**: paste `/metric/active_daily.dau` in Slack and the receiver gets the full picture in one URL. The current playground has no equivalent.

**Source idea:** session brainstorm `cube-meta` (in-conversation, 2026-05-17) — "the single most meaningful /meta product idea is the routable Metric Card."

## Demo Storyboard — what the user will see on the cube-playground UI

End-to-end after P4 lands:

1. **Land on `/catalog`** (already shipping) — clusters of cubes, click `active_daily` card.
2. **DetailPanel slides in** (already shipping) — measure list visible.
3. **Click `active_daily.dau` row** → navigates to `/metric/active_daily.dau` (NEW: P2).
4. **MetricCardPage renders** (NEW: P1) — header shows `active_daily.dau`, title, aggType chip `countDistinctApprox`, format chip, "Wizard · khoitn" provenance if applicable.
5. **Card body** (P1 base + P3 sections):
   - **What it is**: full description
   - **Where it lives**: cube name, cluster info ("joinable with 3 cubes")
   - **How to slice it**: time dim + non-PK dimensions of source cube (P3)
   - **Similar measures**: aggType peers on `active_daily` (P3)
   - **Joinable with**: each joined cube with measure/dim counts (P3)
6. **"Try it" button** (P4) → `/build?cube=active_daily&measure=active_daily.dau&time=active_daily.log_date.day&range=last_30_days` → QueryBuilder mounts, query pre-populated, results pane loads.
7. **Copy link button** copies `/metric/active_daily.dau` to clipboard — Slack-shareable.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [MetricCard component and /metric route shell](./phase-01-metriccard-component-and-metric-route-shell.md) | Completed |
| 2 | [Wire MeasureRow to navigate to MetricCard](./phase-02-wire-measurerow-to-navigate-to-metriccard.md) | Completed |
| 3 | [Joinable-with and similar-measures sections](./phase-03-joinable-with-and-similar-measures-sections.md) | Completed |
| 4 | [Try-it deep-link to Builder with prefilled query](./phase-04-try-it-deep-link-to-builder-with-prefilled-query.md) | Completed |

## Sequence

```
P1 (shell + route + base card)  ──▶  P2 (catalog wiring)
                                  └─▶  P3 (richer sections)  ──▶  P4 (try-it deep-link)

P2 + P3 parallelizable after P1.
P4 depends on P1 (Try-it button exists) but is independent of P2/P3.
```

## Key Decisions (locked)

- **Route:** `/metric/:fqn` where `fqn = cubeName.memberName` (single param, simpler than two-segment).
- **Auth:** reuses `useAppContext()` token via `useCatalogMeta()` — same path the catalog already uses.
- **Data source:** zero new fetches. Reuses `useCatalogMeta()` from `src/pages/Catalog/use-catalog-meta.ts` (already cached at `/catalog` mount). Card-page mounts the hook itself for direct-URL load.
- **Wiring strategy:** `MeasureRow` becomes a clickable navigation surface. For cubes WITH CDP projection, navigation REPLACES the inline-expand (CDP projection content moves into the card's "Where it lives" section). For cubes without CDP projection, the row was non-expandable today — it becomes a link.
- **Try-it deep-link contract:** `/build?cube=X&measure=fqn&time=fqn.timeDim&range=last_30_days`. QueryBuilder root reads URLSearchParams on mount; `cube=` already supported per `detail-panel.tsx:127`; `measure`, `time`, `range` are new.
- **No new nav pill.** Card is reachable from catalog measure rows + direct URL only. Avoids overloading the header (already has Playground / Models / Catalog).
- **POC posture:** fully shipped, no dev-only guard. Author provenance reads from `meta.author` field (already exposed when wizard wrote it). Hand-authored measures show no provenance row — graceful.

## Wiring to existing catalog (the user's framing)

This plan does NOT replace any catalog code. It adds:
- One new component (`MetricCard`)
- One new route (`/metric/:fqn`)
- One new page wrapper (`MetricCardPage` — extracts fqn from URL + filters cubes from `useCatalogMeta`)
- Modifies `MeasureRow` to add click-navigation behavior

It reuses:
- `useCatalogMeta()` (already fetches `?extended=true`)
- `CatalogCube` / `CatalogMeasure` / `CatalogJoin` types
- `useAppContext` token plumbing (already correct)
- Open-in-Playground URL pattern from `detail-panel.tsx:127`
- Wizard chip styling from `measure-row.tsx:65-75`
- Section/Row/Chip styled-components patterns from `detail-panel.tsx`

## Total Effort

≈ 2.5 days. Calendar ~3 days.

| Phase | Effort | Priority |
|-------|--------|----------|
| P1 | 0.5d | P0 (shell) |
| P2 | 0.25d | P1 |
| P3 | 1d   | P1 |
| P4 | 0.5d | P2 |

## Dependencies

No cross-plan blockers. The active wizard rebuild (`260517-1500-new-metric-fullpage-6step-rebuild`) touches `NewMetric/` not `pages/Catalog/`; no file-edit overlap. Wizard's provenance emission landed via earlier work and is already visible on `MeasureRow` as the "Wizard" chip (`measure-row.tsx:65-75`).

## Out of Scope (this plan)

- Editing the card (read-only)
- Bookmarks / favorites
- Search across all cards (covered by catalog page already)
- Lineage view (cube → upstream tables — no `/meta` support)
- Per-measure SQL display (`measure.sql` is 0/59 populated — Cube design)
- Versioning / git-sha provenance (deferred to MM-01 sync work)
- Multi-game scope (single-game `ballistar_vn`)
- Embedding the card in the wizard's find-similar dropdown (future, after wizard v2 lands)

## Open Questions

1. ~~Route shape `/metric/:fqn` vs `/metric/:cube/:member`?~~ **Resolved Validation Session 1:** two-segment `/metric/:cube/:member`. Router-conventional, no dot-in-path edge cases.
2. ~~MeasureRow accordion: keep, replace, or both?~~ **Resolved Validation Session 1:** replace inline expand with navigation; CDP projection moves into the card via P3.
3. Should the card render dimensions of the source cube (`How to slice it` section)? Default: yes, but only if cube has ≤10 non-PK non-hidden dimensions; otherwise show count + "see cube detail" link.
4. What if the user lands on `/metric/:cube/:member` for an unknown pair (typo, deleted measure)? Default: 404 state with link back to `/catalog`.

## Validation Log

### Session 1 — 2026-05-17

**Trigger:** `/ck:plan validate plans/260517-1800-metric-card-routable-measure-detail`
**Tier:** Standard (4 phases → Fact Checker + Contract Verifier, 10 claims/phase)
**Questions asked:** 4

#### Verification Results

- Claims checked: 11
- Verified: 10
- Failed: 1
- Unverified: 0

**Verified (10):**
- `useCatalogMeta` shape `{cubes, loading, error}` at `src/pages/Catalog/use-catalog-meta.ts:51-55`
- `MeasureRow` chip styling at `src/pages/Catalog/measure-row.tsx:65-75`
- `detail-panel-measures.tsx` owns expand state at `src/pages/Catalog/detail-panel-measures.tsx:37`
- `projectMeasure` + `CdpProjectionCard` exist in `src/pages/Catalog/cdp-projection/`
- `KeepAliveRoute` pattern at `src/index.tsx:53-72` (custom component, dom-based mount-once)
- `useHistory` already imported in catalog at `src/pages/Catalog/detail-panel.tsx:2`
- react-router-dom v5 used throughout (`Router/Route/withRouter/useHistory` imports)
- **BONUS:** Existing `?cube=` URL reader at `src/QueryBuilderV2/QueryBuilder.tsx:112-125` — hash-router-aware, waits for meta, applies + strips. Phase 4 should extend, not replace.
- **BONUS:** KeepAliveRoute with `:cube/:member` dynamic params reuses ONE component instance; `useParams` re-renders but `useCatalogMeta` state persists.
- `setQuery(query: Query)` setter at `src/QueryBuilderV2/hooks/query-builder.ts:483`

**Failed (1):**
- [Contract Verifier] Phase 4 cited "addMeasure / addTimeDimension setters" — these do NOT exist on `useQueryBuilder`. The only entry point is `setQuery(query: Query)` taking a full Cube Query object. **Resolved via Q3:** rewrite Phase 4 to build a Query object and call setQuery atomically.

#### Decisions confirmed

1. **Route shape:** `/metric/:cube/:member` (two segments). Router-conventional; eliminates dotted-path edge cases. **Propagated to:** Phase 1 (requirements + steps + risks), Phase 2 (navigation push), Phase 3 (Similar-measures Link).
2. **MeasureRow accordion:** replace inline expand with navigation. CDP projection re-integrates into the card (P3). **Propagated to:** Phase 2 (no change — was already the default), Phase 3 (CDP section added).
3. **Phase 4 setter:** build a full Cube `Query` and call `setQuery(query)` once. No multi-setter API. **Propagated to:** Phase 4 (Implementation Step 3 rewritten with explicit code block, Risks section noted as RESOLVED, Related Code Files updated).
4. **Date range format:** Cube native strings (`"last 30 days"`) passed directly. No custom RANGE_KEYS dictionary. **Propagated to:** Phase 4 (Key Insights + util spec + URL example).

#### Whole-Plan Consistency Sweep

- **Files reread:** plan.md, phase-01, phase-02, phase-03, phase-04
- **Decision deltas checked:** 4 (route shape, accordion, setter, range format)
- **Reconciled stale references:** all `/metric/:fqn` → `/metric/:cube/:member` (across plan.md, phase-01, phase-02, phase-03). Phase 4 setter prose + arch diagram updated to `setQuery`. Phase 4 RANGE_KEYS references replaced with Cube native string pattern.
- **Unresolved contradictions:** 0
- **Stale terms checked:** `:fqn`, `RANGE_KEYS`, `addMeasure`, `addTimeDimension`, `resolveRange` — all replaced or removed.

Whole-plan consistency: **clean**.
