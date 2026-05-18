# Phase 04 — QueryStatePillBar (NEW Component)

## Context Links

- Mockup component: `plans/reports/research-260515-1254-ui-revamp-stitch-standalone-mockup.md` §"Gap Map → 3. Main panel" + §"Per-Feature Plan → C"
- `timeDimensions` explainer: same report §"What is `timeDimensions` for?"
- Decisions: D5 (4 rows, Dim→Meas→Time→Filter, Time keeps granularity chip)
- Existing context exposed at `src/QueryBuilderV2/context.tsx` — `useQueryBuilderContext()` line 7
- Date-range owner: `src/QueryBuilderV2/QueryBuilderExtras.tsx:219` (`QueryBuilderExtras` — 619 LOC, do not edit)
- Mount point: `src/QueryBuilderV2/QueryBuilder.tsx` (144 LOC)
- Alias hook from Phase 03: `src/hooks/use-cube-alias.ts`

## Overview

- **Priority:** P1 (largest visible addition)
- **Status:** completed
- **Brief:** New presentational component above `<QueryBuilderResults>`. Reads query state via existing context, renders 4 MemberPillRows (Dim → Meas → Time → Filter). Reuses existing add/remove member primitives. Embeds existing date-range strip from Extras.

## Key Insights

- **No new business logic.** Subscribe to `useQueryBuilderContext()`; call existing mutators.
- Mockup order is Meas/Dim/Time/Filter; user-decided order (D5) is **Dim/Meas/Time/Filter**.
- `timeDimensions[]` rows must show granularity chip (day|week|month|...) — that's the Cube concept that distinguishes time from raw dimensions.
- **Correction:** `<DateRangeStrip>` does NOT exist in `QueryBuilderExtras`. Extras owns timezone, sort/order, ungrouped, show-totals, limit — no date-range. The real per-timeDim date-range UI is `components/DateRangeFilter.tsx`, mounted inline in the sidebar tree (`SidePanelCubeItem.tsx`, `FilterMember.tsx`).
- **Date-range strategy (decided 2026-05-15, Option B):** Build a new `date-range-strip.tsx` that renders a Segmented control `7d|14d|30d|QTD|Custom`. On change, map the picked range to **every** entry in `query.timeDimensions[]` via `useQueryBuilderContext().updateQuery({ timeDimensions: tds.map(t => ({ ...t, dateRange: <picked> })) })`. This makes the strip behave as the mockup expects (one global range) while honouring Cube's per-timeDim data model.
- **"Custom" handling:** reuse the existing `<DateRangeFilter>` popover component — don't fork. Anchor it to the Custom segment when clicked.
- **Hiding the per-timeDim picker:** the sidebar still renders `<DateRangeFilter>` per time dim. Phase 06 step 9 hides those when the pill bar is mounted to avoid duplication. This phase only needs to *expose* a way for the sidebar to detect the pill bar (e.g. set a context flag or `window.__GDS_PILL_BAR__ = true`).
- The pill bar is **read+remove** primary; **add** delegates to existing MemberPicker overlay (`AddFilterInput` / member-pick popover already in QBv2).

## Requirements

**Functional**
- Renders inside a card matching mockup tokens (white bg, `--radius-card`, `--shadow-xs`, `1px solid --border-card`).
- Card header: title "Query", small "Live" badge, right-aligned `[Save] [Share] [▶ Run]` buttons (Save/Share = OUT OF SCOPE v1, render disabled placeholder OR omit — recommend omit, keep `Run query`).
- 4 rows in order:
  1. **Dimensions** — pill per `query.dimensions[]`; `+ Add` opens existing dimension picker.
  2. **Measures** — pill per `query.measures[]`; `+ Add` opens measure picker.
  3. **Time** — pill per `query.timeDimensions[]` with granularity chip inline; `+ Add` opens time-dim picker.
  4. **Filters** — pill per `query.filters[]` (rendered as `member operator value`); `+ Add` opens filter picker.
- Each pill: member label (alias-aware via `use-cube-alias` — call hook with the cube portion of `Cube.member`), close-X removes via context.
- Footer strip: Date range Segmented (`7d | 14d | 30d | QTD | Custom`).
- Empty rows show ghost `+ Add` only.
- Run query button = primary, brand orange.

**Non-functional**
- Every new file < 200 LOC.
- Zero new state; pure derivation from context.
- Re-renders only when relevant slice of context changes (use `useMemo`).
- No regression in existing add/remove flows.

## Architecture

```
src/QueryBuilderV2/QueryStatePillBar.tsx        ← orchestrator (~150 LOC)
  ├── <CardHeader>                              run + label
  ├── <MemberPillRow kind="dimension"/>
  ├── <MemberPillRow kind="measure"/>
  ├── <MemberPillRow kind="time"/>      ← granularity chip
  ├── <MemberPillRow kind="filter"/>
  └── <DateRangeStrip/>                          extracted

src/QueryBuilderV2/components/member-pill-row.tsx  ← (~150 LOC)
  ├── <Label>                                       110px column
  ├── pills.map(<MemberPill .../>)                   close-X, alias-aware label
  └── <AddMemberButton kind={kind} />                opens existing picker

src/QueryBuilderV2/components/date-range-strip.tsx  ← (~80 LOC)
  Reads query.timeDimensions[0]?.dateRange via context, writes via existing setter
```

**Mount point change** (the only edit outside this phase's owned files):

```tsx
// in QueryBuilder.tsx — insert one line above <QueryBuilderResults/>
<QueryStatePillBar />
<QueryBuilderResults ... />
```

## Data Flow

```
useQueryBuilderContext()
   └── query = { dimensions, measures, timeDimensions, filters, ... }
   └── mutators: addDimension, removeDimension, addMeasure, removeMeasure, …
   └── runQuery()

QueryStatePillBar
   └── reads query.{dimensions,measures,timeDimensions,filters}
   └── reads alias map (Phase 03 hook) to label pills

MemberPill close-X → context.remove<Kind>(member)
MemberPillRow + Add → opens existing picker (MemberPicker / AddFilterInput)
TimeMemberPill granularity chip → context.setGranularity(member, gran)
DateRangeStrip Segmented → context.setDateRange(member, range)
```

## Related Code Files

**Create**
- `src/QueryBuilderV2/QueryStatePillBar.tsx` (~150 LOC)
- `src/QueryBuilderV2/components/member-pill-row.tsx` (~150 LOC)
- `src/QueryBuilderV2/components/date-range-strip.tsx` (~80 LOC)

**Modify**
- `src/QueryBuilderV2/QueryBuilder.tsx` — insert `<QueryStatePillBar />` above `<QueryBuilderResults />` (1-line change)

**Read for context (do NOT modify)**
- `src/QueryBuilderV2/context.tsx`
- `src/QueryBuilderV2/QueryBuilderExtras.tsx`
- `src/QueryBuilderV2/QueryBuilderFilters.tsx`
- existing member-picker / add-filter components (locate during step 1)

## Implementation Steps

1. Grep `context.tsx` for exported mutators. Verify: `setMembers`, `removeMember`, granularity setter, date-range setter. Write down exact names.
2. Locate existing add-flows for dimensions/measures/time/filters. Likely:
   - Add dimension/measure → modal from sidebar OR explicit `<AddMemberButton>` in QBv2 toolbar.
   - Add filter → `AddFilterInput` (search by name in repo).
   - Goal is to **reuse** these — do not reinvent.
3. Implement `date-range-strip.tsx`: Segmented control with options `7d|14d|30d|QTD|Custom`. On change, fan the picked range to ALL `query.timeDimensions[]` via `updateQuery`. "Custom" anchors and opens the existing `components/DateRangeFilter.tsx` popover — do NOT fork it. Read default state from `query.timeDimensions[0]?.dateRange` (highlight the matching segment).
4. Implement `member-pill-row.tsx`:
   - Props: `kind: 'dimension'|'measure'|'time'|'filter'`, `items`, `onRemove(item)`, `onAdd()`.
   - For `kind==='time'`, render extra `<GranularityChip>` inside each pill with click-to-cycle popover.
5. Implement `QueryStatePillBar.tsx`:
   - Pull `query` + mutators from context.
   - Render header with title + Run button (`context.runQuery` or equivalent).
   - Render 4 rows in user-locked order (D5).
   - Render `<DateRangeStrip>`.
6. Insert mount point in `QueryBuilder.tsx`. Do NOT remove or hide `<QueryBuilderExtras>` — it owns timezone/sort/limit/etc which the pill bar does NOT replicate; keep visible. Set `window.__GDS_PILL_BAR__ = true` (or a context flag) so the sidebar's per-timeDim `<DateRangeFilter>` can self-hide in phase 6 to avoid duplicating the global strip.
7. Visual smoke: add a dimension via sidebar → pill appears in pill bar; remove via pill X → disappears from both. Change granularity in time pill → reflected. Run query button executes.
8. `npm run build`.

## Todo List

- [ ] Grep context.tsx for mutator names
- [ ] Locate existing add-member / add-filter components
- [ ] Implement `date-range-strip.tsx`
- [ ] Implement `member-pill-row.tsx` (incl. granularity chip path)
- [ ] Implement `QueryStatePillBar.tsx`
- [ ] Mount in `QueryBuilder.tsx`
- [ ] Visual smoke: round-trip via sidebar ↔ pill bar
- [ ] Confirm Run query button works
- [ ] `npm run build` passes

## Success Criteria

- All 4 rows render with correct labels (alias-aware).
- Adding a member via sidebar adds a pill; removing via pill X removes the member.
- Granularity chip cycles day→week→month→… and triggers re-query when "Run query" pressed.
- Date-range strip changes `timeDimensions[*].dateRange`.
- No double-mount of context, no re-render storms (>30 renders/sec).
- Build green.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Context mutator names don't match expectations | High | High | Step 1 grep first. If shape differs, fall back to `setQuery({...next})` — context exposes the full query object in all QBv2 forks |
| Re-render storm if we subscribe to whole context | Medium | Medium | Memoise slices; use selector pattern if perf regresses |
| Visual duplication with existing Extras row (both show date-range) | Medium | Low | Acceptable v1; hide Extras chrome in phase 6 if duplicated |
| Sidebar + pill bar both trigger picker → modal state conflicts | Low | Medium | Reuse same picker component instance; single open-state managed at QueryBuilder level |
| Granularity chip + Time row redundant with date-range strip | Low | Low | Keep — they're orthogonal (bucket vs filter range) per D5 |

## Security Considerations

- None. Pure presentational; uses existing trusted mutators.

## Rollback

- Remove 1 line in `QueryBuilder.tsx` + delete 3 new files. Full revert restores prior UX.

## Next Steps

Phase 5 reorders results tabs and extracts chart panel; phase 6 may hide redundant Extras chrome that the pill bar now duplicates.

## Unresolved Questions

- Exact context mutator names — locked by step 1 grep.
- Should "Save" / "Share" buttons in card header render (disabled) for visual parity, or be omitted? Recommend omit until v2 saved-queries lands.
- Date-range "Custom" opens existing picker or a new mini-calendar? Default: reuse existing Extras date picker via portal if cheap; else inline calendar.

Status: DONE
