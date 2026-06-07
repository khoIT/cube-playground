# Phase 4 — Shared datetime axis formatter + wire charts

## Context Links
- Segment line chart (no tickFormatter): `src/pages/Segments/visuals/line-chart.tsx:48-54` (XAxis), `:62-71` (Tooltip raw x)
- Data build: `src/pages/Segments/detail/cards/line-chart-card.tsx:40` (`x: String(r['<tdim>.day'])` → raw ISO `2026-04-07T00:00:00.000`)
- Dashboards reuse same LineChart: `src/pages/Dashboards/tile-viz-renderers.tsx:98` (`extractLineData` passes raw strings) — inherits fix free
- Chat charts (JS theme `T`, NOT CSS vars): `src/pages/Chat/components/assistant-chart-section.tsx` — XAxis sites: `295, 306-314, 331, 351, 366, 385, 407, 460, 505-506` (`dataKey={spec.encoding.category}`), scatter `505`; tooltips have NO `labelFormatter`
- Reference util (do NOT import across layer): `src/QueryBuilderV2/utils/format-date-by-granularity.tsx`
- Existing util test dir: `src/utils/__tests__/`
- User decision 3: day-grain "Apr 7" (+year on first tick when range crosses years); hour-grain "Apr 7 14:00"; tooltip "Apr 7, 2026"; date-only when time part is 00:00:00.

## Overview
- Priority: P2. Status: completed. Independent (new util + chart files).
- One shared pure formatter for datetime tick + tooltip labels, wired into segment + chat charts; dashboards inherit via LineChart.

## Requirements
- NEW `src/utils/format-chart-datetime-label.ts` (kebab-case, < 200 LOC, pure, no React, date-fns):
  - `formatAxisTick(raw, { isFirstTick, crossesYears, granularity })` → "Apr 7" | "Apr 7 14:00" | "Apr 7 '26" (year on first tick / year-crossing).
  - `formatTooltipLabel(raw)` → "Apr 7, 2026" (date-grain) or "Apr 7, 2026 14:00" (hour-grain).
  - Detection: parse ISO; if unparseable, return raw unchanged (non-date categories must pass through untouched — chat axes carry arbitrary categories). If time part `00:00:00(.000)` → date-grain; else hour-grain.
- Year logic: caller determines `crossesYears` (min vs max year in data differ) and `isFirstTick`. For recharts `tickFormatter(value, index)` use `index === 0` as first tick; pass `crossesYears` via closure.
- Use date-fns `format` (already a dep) + `parseISO`. NO QueryBuilderV2 import (layering).

## Related Code Files
- Create: `src/utils/format-chart-datetime-label.ts`
- Modify: `src/pages/Segments/visuals/line-chart.tsx` (XAxis `tickFormatter`, Tooltip `labelFormatter`)
- Modify: `src/pages/Chat/components/assistant-chart-section.tsx` (add `tickFormatter` to category XAxis on bar/stacked-bar/line/area/composed/scatter; add Tooltip `labelFormatter`; pie `nameKey` left as-is)
- Read/verify: `src/pages/Dashboards/tile-viz-renderers.tsx` (confirm inherits; no edit expected)
- Modify if needed: `src/pages/Segments/detail/cards/line-chart-card.tsx` (compute `crossesYears` from data once, pass to LineChart prop)

## Implementation Steps
1. Write `format-chart-datetime-label.ts` with the two functions + ISO detection + passthrough for non-dates.
2. In segment `line-chart.tsx`: add `tickFormatter={(v, i) => formatAxisTick(v, {...})}` to XAxis; add Tooltip `labelFormatter={formatTooltipLabel}`. Thread a `crossesYears` prop (default false) from caller.
3. In `line-chart-card.tsx`: compute `crossesYears` from built data; pass to LineChart.
4. In `assistant-chart-section.tsx`: apply `tickFormatter` to all category XAxis sites (9) + Tooltip `labelFormatter`; non-date categories pass through unchanged via detection. Keep theme `T` styling.
5. Verify dashboards render formatted ticks via shared LineChart (manual + tile renderer read).
6. `npx tsc --noEmit`.

## Todo List
- [x] format-chart-datetime-label.ts (pure, passthrough for non-dates)
- [x] segment line-chart XAxis tickFormatter + Tooltip labelFormatter
- [x] line-chart-card computes crossesYears
- [x] chat 9 XAxis + tooltip labelFormatter
- [x] dashboards inherit verified
- [x] tsc passes

## Success Criteria
- Day-grain axis shows "Apr 7"; year-crossing range shows year on first tick; hour-grain "Apr 7 14:00"; tooltip "Apr 7, 2026".
- Non-date chat categories render unchanged (no NaN/blank).
- Dashboards line tiles show short-month ticks without separate edit.

## Risk Assessment
- R: chat categories that look date-ish but aren't (e.g. "2026 cohort") get mangled (Med/Med) → strict ISO parse + passthrough on failure; unit test the ambiguous cases.
- R: recharts passes formatted ticks back into domain calc (Low) → tickFormatter is display-only, safe.
- R: timezone shift when parsing `...T00:00:00.000` (Med/Med) → use date-fns `parseISO` + `format` (local); date-grain branch formats from the date parts only to avoid TZ rollover. Add test at TZ boundary.

## Rollback
- Revert chart edits + delete util; charts fall back to raw ISO (current behavior).

## Next Steps
- P6 unit-tests the formatter incl. TZ + non-date passthrough cases in `src/utils/__tests__/`.
