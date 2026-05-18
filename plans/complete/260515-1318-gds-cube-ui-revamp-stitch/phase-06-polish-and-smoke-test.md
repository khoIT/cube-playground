# Phase 06 — Polish + Manual Smoke Test + Before/After Screenshots

## Context Links

- All prior phase files in this folder.
- Mockup reference: `/Users/lap16299/Downloads/Cube Playground _standalone_.html`
- Backend: `ballistar_cube_api` on `:4000`, `/cubejs-api/*` + `/playground/*` proxied.

## Overview

- **Priority:** P1 (merge gate)
- **Status:** completed
- **Brief:** Verify the assembled revamp end-to-end. Hide redundant chrome if any phase introduced duplication. Capture before/after screenshots. Document any deferred work.

## Key Insights

- After phases 1–5, the QueryBuilder card (pill bar) may visually duplicate `QueryBuilderExtras` rows (date-range, granularity). Decide: keep both (cheap redundancy, two surfaces for power users) OR hide the Extras band.
- "Run query" button now lives in the pill-bar header. Existing `QueryBuilderToolBar.tsx` `[Run]` button is redundant — hide or repurpose.
- No new tests requested in scope; smoke only.
- Build must pass `tsc --noEmit && vite build` (per `package.json` `build` script).

## Requirements

**Functional**
- Dev server `npm run dev` boots without console errors.
- `/build` page renders: new header, sidebar with alias-editable cubes, pill-bar card, results-default tabs, collapsible chart.
- `/schema` page renders without regressions.
- Adding/removing dimensions/measures/time/filters via the pill bar updates context and triggers `runQuery`.
- Cube/view alias rename + icon persists across reload.
- Mock cube `active_daily` (or any present cube) executes a query end-to-end producing a result table.
- Chart panel expands → renders line chart with brand-orange palette.

**Non-functional**
- `npm run build` exits 0.
- No new TypeScript errors (`tsc --noEmit`).
- No new console errors / warnings in dev console on `/build` and `/schema`.
- Page-load time visually comparable to pre-revamp (no obvious regression).

## Architecture

This phase touches no business logic. It's a verification + cleanup pass.

```
1. Visual diff vs mockup
2. Hide redundant Extras chrome if duplicated by pill bar
3. Hide redundant Run button in QueryBuilderToolBar
4. Screenshots (before / after)
5. Update plan.md statuses
6. Note unresolved follow-ups
```

## Related Code Files

**Read for verification (do NOT modify)**
- All phase 1–5 owned files.

**Modify (if needed)**
- `src/QueryBuilderV2/components/SidePanelCubeItem.tsx` and `components/FilterMember.tsx` — hide per-timeDim `<DateRangeFilter>` when the pill bar's global date-range strip is mounted. Pass a `hideDateRange` prop down or check a CSS body class. **Do not delete the date-range filter component — alternative entry surfaces (REST/GraphQL tabs) may still need it.**
- `src/QueryBuilderV2/QueryBuilderToolBar.tsx` — hide the redundant Run button if pill bar's Run button is wired identically.

**Note (corrected from initial plan):** `QueryBuilderExtras` does NOT contain a date-range strip. It exposes timezone, sort/order, ungrouped, show-totals, limit. The duplication concern is between the new pill bar's *global* `<DateRangeStrip>` (one Last 7d/14d/30d/QTD/Custom segmented) and the *per-timeDim* `<DateRangeFilter>` rendered in the sidebar tree. Leave `Extras` untouched in this phase.

**Create**
- `plans/260515-1318-gds-cube-ui-revamp-stitch/screenshots/` — before/after PNGs.

**Delete**
- None.

## Implementation Steps

1. Run `npm run dev`. Open `/build` in browser. Visual sweep against mockup screenshot.
2. Add a dimension via sidebar → verify pill appears in pill bar. Remove via pill X → verify it disappears from both.
3. Add a measure, change granularity on time pill, change date-range strip → verify `runQuery` re-runs and result table updates.
4. Expand chart panel → verify orange line + KPI cards render.
5. Click each tab (Results, Pivot, SQL, JSON, REST, GraphQL) → verify each renders without console error.
6. Open Sidebar `…` editor on a cube → set displayName "Daily Users" + icon "users". Save. Reload page. Verify alias survives.
7. Repeat #6 on a view.
8. Resize window <992px → mobile dropdown still works in header.
9. Resolution — duplicate chrome (decided 2026-05-15, Option B):
   - **Hide per-timeDim `<DateRangeFilter>` in sidebar `SidePanelCubeItem.tsx` + `FilterMember.tsx`** when the pill bar's global strip is mounted (always-on in v1). Wrap the DateRangeFilter JSX with `{!isPillBarMounted && (...)}` — read `isPillBarMounted` from a thin React context or a `window.__GDS_PILL_BAR__` boot flag set by `QueryBuilder.tsx`.
   - **Semantic mapping for the global strip:** when user picks a range in the pill bar (e.g. "Last 14d"), set `dateRange` on **every entry in `query.timeDimensions[]`** via `useQueryBuilderContext().updateQuery({ timeDimensions: tds.map(t => ({ ...t, dateRange: <picked> })) })`. Document this in the pill bar code comment.
   - **Custom range:** if user picks "Custom" in the pill bar strip, open the existing `<DateRangeFilter>` popover as a modal-ish anchor (reuse the component, don't fork).
   - **`Extras` itself is untouched** in this phase — timezone, sort, ungrouped, show-totals, limit all stay visible (no duplication).
   - **ToolBar Run button:** hide if pill bar's Run is wired to the same `runQuery` from context. Else keep.
10. Take "before" screenshots from the *previous* main branch (checkout, screenshot, switch back) OR use the original Stitch mockup as "target" reference. Save "after" screenshots.
11. Run `npm run build`. Confirm exit code 0.
12. Update each phase file's status from `pending` → `completed`. Update `plan.md` status table.
13. List deferred items + unresolved questions in this phase's "Unresolved Questions" section.

## Todo List

- [ ] Dev server boots cleanly
- [ ] Visual sweep `/build` vs mockup
- [ ] Round-trip add/remove members via sidebar ↔ pill bar
- [ ] Granularity + date-range strip triggers re-query
- [ ] Chart panel expand + KPI render
- [ ] All 6 tabs render
- [ ] Alias rename + icon survives reload (cube + view)
- [ ] Mobile (<992px) header dropdown works
- [ ] Hide per-timeDim DateRangeFilter in sidebar when pill bar strip mounted
- [ ] Hide duplicated ToolBar Run button (if applicable)
- [ ] Before/after screenshots saved
- [ ] `npm run build` passes
- [ ] Phase statuses updated to `completed`

## Success Criteria

- All Todo items checked.
- Build green.
- No console errors during smoke.
- Before/after screenshots committed under `plans/260515-1318-gds-cube-ui-revamp-stitch/screenshots/`.
- Plan file statuses reflect reality.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hidden Extras date-range loses some path users relied on | Medium | Medium | Keep Extras mounted; only hide visually via wrapper — easy unflip |
| Build fails due to unused exports in phase 5 deletion candidates | Medium | Low | If TS strict, `// @ts-expect-error` or restore exports; prefer restoration |
| Mockup screenshot not committable (proprietary) | Low | Low | Use cropped fair-use screenshot; or describe diff in text |
| Real cube data unavailable when smoke-testing (DB warm-up) | Low | Medium | Hit `:4000/cubejs-api/v1/meta` first to confirm meta loaded |
| Visual regression on `/schema` route from token changes | Low | Medium | Sweep `/schema` too; restyle if needed (defer-cost low) |

## Security Considerations

- Verify alias localStorage payload size cap not approached on test profile (alias map is tiny, no risk).
- No new endpoints exposed.

## Rollback

- Revert phases 5 → 4 → 3 → 2 → 1 in that order. Each phase rollback steps documented in its own file.
- Localstorage entries (`gds-cube:cube-aliases`) harmless if left behind.

## Migration / Backwards Compatibility

- Existing query URLs continue to resolve.
- New alias map is additive; missing entries fall back to `meta.title ?? meta.name`.
- antd 4 not upgraded; UI-kit not bumped; React not bumped.

## Definition of Done (Project)

- Header looks like mockup top bar.
- Sidebar matches mockup style with alias-rename + icon picker working.
- Query pill bar visible above results.
- Results = default tab; chart = collapsible panel.
- Build green, no console errors, smoke passes.
- Plan files updated.

## Next Steps (Post-merge / Deferred)

- v2: promote alias to real YAML rename (requires `:rw` mount + sidecar — see backend research §"Option B").
- v2: saved-queries right rail.
- v2: AI-assist / RequestMetricModal product surface.
- v2: previous-period delta on chart KPI cards.
- v2: VNG logo asset from design team replacing placeholder.

## Unresolved Questions

- Final call on hiding Extras date-range — verify during step 9 smoke.
- Should `/schema` page also adopt new chrome, or stay current? Out of scope for this plan, flag for follow-up.
- Screenshot policy — store inside plans dir (committed) or attach to PR only?

Status: DONE
