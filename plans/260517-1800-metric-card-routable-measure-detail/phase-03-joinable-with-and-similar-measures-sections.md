---
phase: 3
title: "Joinable-with and similar-measures sections"
status: completed
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 3: Joinable-with and similar-measures sections

## Context Links

- Existing wizard reachability hook (graph-builder reusable): `src/QueryBuilderV2/NewMetric/hooks/use-reachable-members.ts`
- Catalog cluster grouping: `src/pages/Catalog/use-cube-clusters.ts`
- CDP projection (to fold INTO card): `src/pages/Catalog/cdp-projection/`
- Phase 1 output: `MetricCard` with base sections (header, what-it-is, where-it-lives, provenance)

## Overview

Add the four sections that turn the card from "rendered measure" into "metric exploration unit":

- **How to slice it** — source-cube dimensions list (curated: type-time + non-PK + public-true)
- **Similar measures** — aggType peers on the same cube
- **Joinable with** — per-joined-cube section with measure/dim counts (uses `cube.joins[]` from `?extended=true`)
- **CDP projection** — re-integrate the existing CdpProjectionCard component (lifted out of DetailPanelMeasures in P2)

These are the sections that justify a per-measure URL existing at all. Without them, the card is a tooltip.

## Priority

P1 — necessary for the card to be more valuable than the existing tooltip or DetailPanel measure row.

## Key Insights

- `cube.joins[]` is populated in `?extended=true` payload (`useCatalogMeta` already requests this). Each join has `{ name, relationship?, sql }`.
- For "Joinable with", we need PER-JOIN-TARGET measure + dimension counts. Look up the joined cube by name in `cubes[]` and read its array lengths.
- "Similar measures" filters `cube.measures` where `m.aggType === measure.aggType && m.name !== measure.name`. Sort: description-present-first, then alphabetical (carried over from validation decisions on the cancelled 1700 plan).
- "How to slice it" lists `cube.dimensions` filtered: `public !== false && !primaryKey`. If the cube has a `type: time` dimension, surface it first (it's the most common slice axis for measures over time).
- CDP projection re-integration: the card already takes `{ cube, measure }`; call `projectMeasure(cube, measure)` and conditionally render `<CdpProjectionCard>` when `projection.ok === true`.
- All sections derive from data already in the loaded `cubes` array — no new fetches, no new hooks needed beyond two tiny memo'd derivations.

## Requirements

### Functional

**How to slice it section:**
- Renders when `cube.dimensions` has at least one non-PK, non-hidden member.
- Time dimension(s) listed first with a "time" indicator.
- Each entry: `Code` name + type chip.
- If >10 dimensions, show first 10 + "and N more" with a link to the cube DetailPanel.

**Similar measures section:**
- Renders when ≥1 same-aggType peers exist on the source cube.
- Each row: clickable `MeasureRow`-style entry that navigates to that peer's `/metric/:cube/:member`.
- Up to 5 peers; sorted description-first, then alphabetical.
- Section hidden when 0 peers.

**Joinable with section:**
- Renders when `cube.joins?.length > 0`.
- Each joined cube: `Code` name + count chips (`N measures · M dimensions`) + truncated join sql snippet (`Code` block, mono).
- Joined cube name links to the joined cube's catalog detail (`/catalog?cube=X` — wire to existing catalog cube-select state if the URL contract exists; otherwise navigate to `/catalog` and rely on the cube list).
- Section hidden when 0 joins (covers the 7 standalone views).

**CDP projection section:**
- Renders when `projectMeasure(cube, measure).ok === true`.
- Embeds `<CdpProjectionCard projection={...}>` inside a card section header "CDP Projection".
- Hidden otherwise (cubes without CDP mapping show no section).

### Non-functional
- All four sections are pure-derive from props — no new effects, no new fetches.
- Memoize the per-cube join-target counts to avoid recomputing per render.
- File size: `metric-card.tsx` may exceed 200 LOC with all sections. Plan: extract each section to a sibling file (`metric-card-sections.tsx` or per-section files) if it does. Decide during implementation.

## Architecture

```
MetricCard({ cube, measure })
  ├─ <Header>                          [P1]
  ├─ <Section "What it is">             [P1]
  ├─ <Section "Where it lives">         [P1, extended in P3 to include cluster details]
  ├─ <Section "How to slice it">        [P3 NEW]
  │     └─ derive: cube.dimensions filtered + time-first sort
  ├─ <Section "CDP Projection">         [P3 RE-INTEGRATION]
  │     └─ projectMeasure(cube, measure) → CdpProjectionCard
  ├─ <Section "Similar measures">       [P3 NEW]
  │     └─ derive: cube.measures filtered by aggType + sorted
  │     └─ navigates to /metric/:cube/:member on click
  ├─ <Section "Joinable with">          [P3 NEW]
  │     └─ for each cube.joins[]: lookup target cube + counts
  └─ <Provenance>                       [P1]
```

## Related Code Files

- **Modify:**
  - `src/pages/Catalog/metric-card.tsx` — add 4 new sections; if exceeding 200 LOC, extract to sibling files
- **Possibly create (if size pressure):**
  - `src/pages/Catalog/metric-card-similar-measures.tsx`
  - `src/pages/Catalog/metric-card-joinable-with.tsx`
  - `src/pages/Catalog/metric-card-how-to-slice.tsx`
- **Update prop wiring:**
  - `MetricCardPage` may need to pass full `cubes` array (not just the single matching cube) so the card can resolve join targets. Currently passes `{cube, measure}` — extend to `{cube, measure, allCubes}` or refactor to expose a `cubesByName` map.
- **Read for context (no edits):**
  - `src/pages/Catalog/cdp-projection/project-measure.ts` — projection function signature
  - `src/QueryBuilderV2/NewMetric/hooks/use-reachable-members.ts:30-67` — join-graph builder pattern (can be inlined into card; do NOT import the wizard hook directly — too much wizard-context coupling)

## Implementation Steps

1. **Extend MetricCard props.** Change `MetricCardPage` to pass `allCubes: CatalogCube[]` alongside `cube` and `measure`. Build a `cubesByName: Map<string, CatalogCube>` once inside `MetricCard` via `useMemo`.
2. **Add "How to slice it" section.** Filter `cube.dimensions` where `dim.public !== false && !dim.primaryKey`. Move time dimensions to the front. Render up to 10 with overflow message.
3. **Add "Similar measures" section.** Filter `cube.measures` where `m.aggType === measure.aggType && m.name !== measure.name`. Sort `description !== undefined` first, then alphabetical by name. Limit 5. Each row uses two-segment Link: split `m.name` on first dot → `<Link to={`/metric/${peerCube}/${peerMember}`}>` (react-router-dom v5).

<!-- Updated: Validation Session 1 - two-segment Link path, not /metric/:fqn -->

4. **Add "Joinable with" section.** Iterate `cube.joins ?? []`. For each `join`: lookup `cubesByName.get(join.name)`. Render entry with name + counts + truncated join.sql. Joined cube name → link to a future cube-detail surface (for now: link to `/catalog` and let user click the cube card; revisit).
5. **Re-integrate CDP projection.** Import `projectMeasure` and `<CdpProjectionCard>`. Call `projectMeasure(cube, measure)`. Conditionally render the section + card.
6. **Split into sibling files if `metric-card.tsx` > 200 LOC.** Use the kebab-case naming pattern of the catalog folder.
7. **Visual smoke:**
   - `/metric/active_daily.dau` shows 3 same-aggType peers in Similar measures.
   - `/metric/active_daily.dau` shows mf_users + recharge + user_recharge_daily in Joinable with, each with measure/dim counts.
   - `/metric/active_daily.dau` shows time dim (`log_date`) at top of How to slice it.
   - `/metric/mf_users.<measure>` shows joins from mf_users out (3 joins).
   - `/metric/<view>.<measure>` shows NO Joinable with section (views have no joins).
   - CDP projection card renders for measures on cubes with `cdp_source` mapping.

## Todo List

- [ ] Extend `MetricCardPage` to pass `allCubes` prop
- [ ] Build `cubesByName` map inside `MetricCard`
- [ ] Add "How to slice it" section (time-dim-first sort, truncate at 10)
- [ ] Add "Similar measures" section with `/metric/:cube/:member` links
- [ ] Add "Joinable with" section with per-target counts + sql preview
- [ ] Re-integrate `CdpProjectionCard` into card
- [ ] Decide split-into-siblings if exceeding 200 LOC
- [ ] Smoke: all 6 sections render correctly for `active_daily.dau`
- [ ] Smoke: standalone view measure shows no Joinable-with
- [ ] Smoke: measure without aggType peers hides Similar-measures section

## Success Criteria

- [ ] `/metric/active_daily.dau` displays all sections that have data (header, what-it-is, where-it-lives, how-to-slice, similar, joinable, CDP if applicable, provenance)
- [ ] Similar-measures links navigate to peer cards
- [ ] Joinable-with section uses real `cube.joins[]` + counts from joined cubes
- [ ] CDP projection appears for cubes with `meta.cdp_source` (same condition as previous inline expand)
- [ ] No section appears when its data is empty (no empty headers)
- [ ] Card remains under 200 LOC per file (split if necessary)

## Risk Assessment

- **Risk:** "Joinable with" cube lookup fails if the joined cube isn't in `cubes[]` (e.g. filtered out by visibility). Mitigation: render the join name + sql even when target cube is unresolved; just omit counts.
- **Risk:** Similar-measures sort is stable enough but may surface unhelpful peers (e.g. all 4 countDistinctApprox on `active_daily` show even when the user is on `dau` — fine since `dau_exact` is meaningfully similar). Acceptable for POC.
- **Risk:** Card grows visually long with all sections. Mitigation: page is scrollable; section order prioritizes "fast read" → "deep dive" (description first, joinable-with later).
- **Risk:** `useReachableMembers` graph-builder is reusable but coupled to wizard's `QueryBuilderContext`. Mitigation: do NOT import it directly. Inline the small graph build inside `MetricCard` using `cubes[]` + lookup map — ~10 LOC.

## Security Considerations

- All data is already on the page (no new fetches). No new auth surface.
- Join `sql` field is rendered as `<Code>` text content — React auto-escapes. Safe.
