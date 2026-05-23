---
phase: 8
title: "Catalog + NewMetric game-aware polish"
status: pending
priority: P2
effort: "1.5d"
dependencies: [1, 2]
brainstormId: P6
---

# Phase 8 (P6): Catalog + NewMetric game-aware polish

## Context Links

- Brainstorm: `../reports/brainstorm-260520-2311-segments-first-class-redesign.md` §10
- Existing Catalog: `src/pages/Catalog/{catalog-page,catalog-grid,catalog-toolbar,catalog-tabs,cube-card,metric-card,metric-card-page,detail-panel,...}`
- Existing NewMetric: `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx`

## Overview

Light-touch DS polish across Catalog and New Metric. Apply VNGGames Player Hub tokens (already aligned in Phase 1), pill buttons, sentence-case sweep, Lucide icon audit, no-emoji audit, chart palette swap. Plus: filter Cube/metric lists by active `gameId` from Phase 2.

## Key Insights

- These surfaces are out-of-scope for *restructure* (brainstorm §2 non-goal) but in-scope for *consistency*. The brand identity story breaks if Segments looks first-class and the adjacent pages don't.
- Most token swaps happen for free because Phase 1 aligned `--brand`, fonts, button radii. This phase is mostly QA + the game-id filter.
- Game-id filter is structural change but small: append `?game_id=` to existing list calls; server filters Cube meta accordingly.
- Server-side filter for Cube meta needs a per-game schema convention. If not present today, this phase ships the client filter param and server returns unfiltered for now (logged warning).

## Requirements

**Functional**
- Catalog cube list and metric list filtered by active `gameId` from AppContext.
- Catalog page title → sentence case ("Catalog of cubes and metrics" or similar).
- All buttons → pill radius (inherited from Phase 1 antd override).
- Audit copy for Title Case / emoji / Unicode arrows → sentence case / no emoji / Lucide.
- Chart components inside Catalog metric-card use `--chart-1..5` palette.
- Empty states: flat neutral panel, no decorative imagery.
- NewMetric wizard:
  - Pre-fill `game_id` field from AppContext.
  - Source cube picker scoped to `gameId`.
  - Pill buttons / sentence case sweep.

**Non-functional**
- LOC ≤ 400 total across surfaces.
- No new component files unless an existing one breaches 200 LOC after this phase.
- No new API endpoints; reuse existing Cube meta endpoints with `?game_id=` extension if supported.

## Architecture

```
src/pages/Catalog/
  ├─ catalog-page.tsx         — sentence-case title, game-aware fetch
  ├─ catalog-toolbar.tsx      — pill buttons, search styling
  ├─ catalog-grid.tsx         — empty states
  ├─ cube-card.tsx            — DS radii + shadow + chart palette
  ├─ metric-card.tsx          — DS radii + shadow + chart palette
  ├─ use-catalog-meta.ts      — append ?game_id= to fetch
  └─ (audit all *.tsx for emoji / Unicode arrows / Title Case)

src/QueryBuilderV2/NewMetric/full-page/
  ├─ NewMetricPage.tsx        — DS polish + game_id prefill
  └─ (audit steps for sentence case + Lucide swap)
```

## Related Code Files

**Modify**
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Catalog/catalog-page.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Catalog/catalog-toolbar.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Catalog/catalog-grid.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Catalog/cube-card.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Catalog/metric-card.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Catalog/metric-card-page.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Catalog/use-catalog-meta.ts` (append `?game_id=`)
- `/Users/lap16299/Documents/code/cube-playground/src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/i18n/*` (Catalog + NewMetric sentence-case sweep)

**Create** — none (no new abstractions).
**Delete** — none.

## Implementation Steps

1. **Copy audit** — Grep `src/pages/Catalog/` + `src/QueryBuilderV2/NewMetric/` for:
   - Title Case in `t('...')` strings → flip i18n.
   - Emoji literals → remove.
   - Unicode arrows (`→`, `←`, `▾`, `×`) → replace with Lucide.
   - Ant icons (`@ant-design/icons`) → replace with Lucide equivalents.
2. **`use-catalog-meta.ts`** — Append `?game_id=<gameId>` from AppContext to fetch URL.
3. **Server side** — If Cube meta endpoint supports per-game schema, filter accordingly. If not, log warning and proceed (out-of-scope to introduce schema-by-game convention; flag for future).
4. **Cube card + Metric card** — Set radius to `var(--radius-lg)` (10px), shadow `var(--shadow-sm)`, padding 24px. Replace chart palette references with `--chart-1..5`.
5. **Catalog toolbar** — Pill button audit (relies on Phase 1 antd override).
6. **Empty states** — Replace any decorative imagery / illustrations with flat neutral panel + 1-line description per Player Hub style.
7. **NewMetric** — Prefill `game_id` field from AppContext. Source-cube picker filters by `gameId`. Audit steps for sentence case + Lucide.
8. **Manual QA sweep** — Open Catalog and NewMetric at active game `ptg`, switch to `ballistar`, verify lists update.

## Todo List

- [ ] Catalog copy audit (Title Case / emoji / Unicode / Ant icons)
- [ ] NewMetric copy audit
- [ ] `use-catalog-meta.ts` append `?game_id=`
- [ ] Cube card + Metric card DS polish (radii, shadow, padding, chart palette)
- [ ] Catalog empty-state flatten
- [ ] NewMetric `game_id` prefill + source-cube filter
- [ ] Manual QA: switch games, verify Catalog + NewMetric re-scope

## Success Criteria

- [ ] Catalog visually consistent with Segments (same tokens, shadows, button shapes, copy voice).
- [ ] NewMetric `game_id` prefilled when game is active.
- [ ] Switching games re-fetches Catalog cube/metric list.
- [ ] No emoji, no Unicode arrows, no Ant icons remain in Catalog or NewMetric source.
- [ ] Buttons pill-shaped across both surfaces.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Cube meta endpoint doesn't support per-game filter (server-side schema not namespaced) | M | Phase ships client-side `?game_id=` param + server logs warning; if server can't filter, render all cubes with note "all games shown — schema not namespaced". Document for future scope |
| Ant icon → Lucide swap changes icon dimensions and breaks layouts | L | One-by-one swap with visual diff; Lucide default 24×24 matches Ant's |
| Chart palette swap shifts colors users associate with metrics | L | Document the palette change in release notes; offer per-user override later if backlash |
| Sentence-case sweep breaks i18n keys consumed elsewhere | L | Diff i18n files; verify no external module imports specific copy strings |

## Security Considerations

- `?game_id=` param sanitized server-side identical to Phase 2 pattern.
- No new auth surface.

## Next Steps

Penultimate phase. Phase 9 dark-mode pass audits Catalog + NewMetric alongside Segments.
