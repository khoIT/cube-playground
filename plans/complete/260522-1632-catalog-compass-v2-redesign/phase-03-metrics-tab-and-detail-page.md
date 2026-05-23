---
phase: 3
title: "Metrics tab and detail page"
status: done
priority: P1
effort: "5d"
dependencies: [1, 2]
---

# Phase 3: Metrics tab and detail page

## Overview

Build the consumer surface — Metrics tab grid + `MetricDetailPage` with 5-tab shell. Lineage / Anomaly / Activation hooks land empty in this phase; P4 wires them. **Heaviest phase** — may split during cook.

## Requirements

**Functional:**
- Metrics tab grid renders all P2 registry entries
- **Game-Context aware:** read active game via `useActiveGameId()` (from completed plan 260520); intersect each metric's `game_compatibility.required_cubes` with active-game `/meta` cube names. Incompatible metrics rendered DISABLED with tooltip "Not available for {gameLabel} — missing: {missingCubes.join(', ')}". Count chip shows "14 of 20 available for {gameLabel}".
- Game-Context change → grid re-renders without re-fetching registry (intersection is pure)
- Cards: TypeIcon · TierBadge · label · synonyms · description · TrustBadge · FreshnessChip · DomainChip · owner avatar · (disabled overlay when incompatible)
- Filter rail: Domains (7) · Trust (5) · Owners · Tiers · Parameterised toggle · Show deprecated toggle · **"Hide unavailable for this game" toggle (default ON)**
- Search row: substring on label/synonyms/description · result count · grid/table toggle
- "Smart search" button stub (P7)
- Click compatible card → `/catalog/metric/:id` → MetricDetailPage 5-tab shell
- Click incompatible card → tooltip only (no navigation)
- Right rail: Open in Explore (live) · Push to activation (stubbed P4) · Subscribe (stubbed P9) · Edit (stubbed)
- "+ New metric" header CTA → `/catalog/metric/new` (P6 delivers)

**Non-functional:**
- Card render < 16ms each for 100-entry grid (virtualise if exceeded)
- Filter interactions don't re-fetch registry
- Detail page first paint < 500ms warm cache

## Architecture

```
src/pages/Catalog/metrics-tab/
├── metrics-tab.tsx                 # MODIFY — placeholder → full grid
├── metrics-grid.tsx                # NEW — virtualised grid
├── metrics-filter-rail.tsx         # NEW — 6 facets
├── metric-card.tsx                 # NEW — single KPI card
├── metrics-search-row.tsx          # NEW
├── use-filtered-metrics.ts         # NEW — filter+search composition
├── seeding-banner.tsx              # NEW — GDS-1.8 import banner
└── __tests__/...

src/pages/Catalog/metric-detail/
├── metric-detail-page.tsx          # NEW — route /catalog/metric/:id
├── metric-detail-header.tsx        # NEW
├── metric-detail-tabs.tsx          # NEW — 5-tab strip
├── tab-overview.tsx                # NEW
├── tab-formula.tsx                 # NEW
├── tab-lineage.tsx                 # NEW — placeholder, P4 wires
├── tab-slices.tsx                  # NEW
├── tab-activity.tsx                # NEW — stub
├── right-rail.tsx                  # NEW
└── __tests__/...

src/shared/concept-shell/           # NEW — shared with P5 ConceptDetail
├── trust-badge.tsx
├── freshness-chip.tsx
├── domain-chip.tsx
├── tier-badge.tsx
├── type-icon.tsx
└── compass-tokens.css              # port from compass/compass-tokens.css
```

**Compass tokens** to port: Trust (5 states), Freshness (3), Type (3), Domain (7).

## Related Code Files

**Create:** ~17 files (see Architecture)

**Modify:**
- `src/pages/Catalog/catalog-page.tsx` — register `/catalog/metric/:id` route
- `src/pages/Catalog/metrics-tab/metrics-tab.tsx` — replace placeholder

## Implementation Steps

1. **Port Compass tokens** — copy `compass-tokens.css` from mockup, reconcile with existing project tokens.
2. **Build shared shell components** (Trust/Freshness/Domain/Tier badges + TypeIcon) per Compass `patterns.jsx`.
3. **Build MetricCard** — header (TypeIcon+TierBadge+label), description (2-line clamp), badge strip, footer (owner+AnomalyBadge slot).
4. **Build MetricsFilterRail** — 6 collapsible facet groups; state lifted to MetricsTab.
5. **Build MetricsSearchRow** — input + clear + Smart-search ghost + count + grid/table toggle.
6. **Build `useFilteredMetrics(metrics, filters, query, activeGameMetaCubes)`** — pure derivation; substring scoring; intersect `game_compatibility.required_cubes` with `activeGameMetaCubes` to compute `availableForGame` boolean per metric. Honor "Hide unavailable" filter toggle (default ON).
7. **Compose MetricsTab** — rail (left) + search row (top) + grid (right). Empty state + seeding banner.
8. **Build MetricDetailPage shell** — read `:id`, find via `useBusinessMetrics`. 404 with back-to-Catalog. Header + tab strip + content + right rail.
9. **Build each tab body:**
   - Overview: description + tier + synonyms + owner + sparkline placeholder + linked-usage stub
   - Formula: render formula.type-specific layout (ratio/passthrough/parameterised) w/ FQN links
   - Lineage: "Coming in Phase 4" placeholder
   - Slices: render `related_concepts` as cards w/ reachability badge
   - Activity: empty stub
10. **Wire right rail** — Open in Explore (push to QueryBuilder preloaded); 3 others disabled w/ tooltip referencing delivery phase.
11. **Add seeding banner** — visible when registry < N; CTA links to seed docs.
12. **Test:** card rendering, filter narrowing, search by synonym, grid→detail roundtrip.

## Success Criteria

- [ ] All seed metrics render in Metrics tab
- [ ] **Switching active game (ballistar ↔ ptg) re-renders grid; PTG hides DAU/ARPDAU metrics by default**
- [ ] **Toggling "Hide unavailable" off shows DAU/ARPDAU disabled with tooltip listing missing cubes**
- [ ] **Count chip shows "X of Y available for {gameLabel}"**
- [ ] Filter by Domain narrows grid
- [ ] Filter by Trust narrows grid
- [ ] Search "arpu_daily" returns ARPDAU
- [ ] Click ARPDAU → MetricDetailPage opens, header populated
- [ ] Formula tab renders ratio expression
- [ ] Slices tab shows `related_concepts` cards
- [ ] "Open in Explore" navigates with metric preloaded
- [ ] Empty registry shows seeding banner
- [ ] Bundle size delta < 8%

## Risk Assessment

- **Heaviest phase.** **Mitigation:** if cook overruns, split into P3a (grid) + P3b (detail).
- **Sparkline data source open Q4.** **Mitigation:** placeholder component this phase; real source P8.
- **Compiled SQL preview needs Cube `/sql` endpoint.** **Mitigation:** stub if endpoint missing.
- **MetricCard naming vs cube-card.tsx** — namespace styled components to avoid clash.
- **Inline-edit vs toggle (open Q2).** **Mitigation:** ship as toggle-edit; flag for future Tweak swap.
