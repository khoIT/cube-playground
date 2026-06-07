# Phase 5 — Card-shell icon + unit chip redesign

## Context Links
- Card shell: `src/pages/Segments/detail/cards/card-shell.tsx` (title 13px/600 + subtitle 11px via `humanizeMeasure`; collapsible + non-collapsible branches)
- humanize: `src/pages/Segments/detail/cards/humanize-measure.ts` (`humanizeMeasure(fqn)`)
- 5 callers (all pass `subtitle={humanizeMeasure(spec.measure)}`):
  - `cards/line-chart-card.tsx:45-47`
  - `cards/bar-list-card.tsx:41-43`
  - `cards/donut-card.tsx:41-43`
  - `cards/composition-card-component.tsx:44-46` (also passes empty inner title — see comment `:53`)
  - `cards/segmented-bar-card.tsx:43-45`
- Icon resolver pattern to mirror: `resolveKpiIcon` at `headline-stats-row.tsx:34`
- Member360 SectionCard reference: `src/pages/Segments/member360/sections/dashboard-stats.tsx`
- User decision 4: icon + title (member360 style); measure name becomes small muted unit chip RIGHT of title, shown ONLY when it adds info beyond title; remove redundant subtitle line.

## Overview
- Priority: P2. Status: completed. Independent (cards files only).
- Replace the title+subtitle stack with member360-style header: leading icon, title, optional trailing muted unit chip. Drop the always-on subtitle.

## Requirements
- `CardShell` gains: `icon?: ReactNode` (rendered left of title), `unitChip?: string` (small muted chip right of title). Deprecate/remove `subtitle` rendering (keep prop optional for transition, but stop showing the redundant line).
- Header layout matches member360: icon chip + title; chip uses muted token (`var(--text-secondary)` / `var(--muted-soft)`), small font (11px), token radius. Tokens only, `var(--font-sans)`, scale spacing.
- Redundancy check (NEW helper, pure, < 60 LOC): given card `title` + humanized measure, return chip text ONLY if humanized tokens are NOT a subset of title tokens (case-insensitive word-set). If subset → no chip.
- Icon resolution: NEW helper `resolve-card-icon.ts` mirroring `resolveKpiIcon` heuristic (measure/cube → lucide icon); default fallback icon. Keep < 200 LOC.
- Preserve collapsible behavior (chevron button) in both branches; icon + chip must render in both collapsed/expanded header states.

## Related Code Files
- Modify: `src/pages/Segments/detail/cards/card-shell.tsx` (add icon/unitChip; render member360 header; stop showing subtitle)
- Create: `src/pages/Segments/detail/cards/resolve-card-icon.tsx` (icon heuristic)
- Create: `src/pages/Segments/detail/cards/card-unit-chip.ts` (redundancy check → chip text or undefined)
- Modify 5 callers: pass `icon={resolveCardIcon(spec)}` + `unitChip={cardUnitChip(spec.label, humanizeMeasure(spec.measure))}`; drop `subtitle`.
- composition-card-component.tsx: keep empty inner title (CardShell still owns header).

## Implementation Steps
1. Add `icon` + `unitChip` props to `CardShell`; build shared header sub-render used by both collapsible/non-collapsible branches (DRY — currently duplicated). Remove subtitle render.
2. Write `card-unit-chip.ts`: tokenize title + humanized measure (lowercase words), return humanized string if not subset else undefined.
3. Write `resolve-card-icon.tsx`: map by measure/cube keywords to lucide icons (reuse keyword set from `resolveKpiIcon`); default icon.
4. Update all 5 callers: add icon + unitChip, remove subtitle.
5. `npx tsc --noEmit`.

## Todo List
- [x] CardShell icon + unitChip props, shared header sub-render, subtitle removed
- [x] card-unit-chip.ts redundancy check
- [x] resolve-card-icon.tsx heuristic
- [x] update 5 callers (line/bar-list/donut/composition/segmented-bar)
- [x] tsc passes

## Success Criteria
- Each chart card shows leading icon + title; unit chip appears only when it adds info (e.g. title "Revenue over time" + measure "Revenue (VND)" → chip "VND"-ish or hidden if subset).
- Redundant subtitle line gone. Collapsible cards still toggle. Tokens only, member360-consistent.

## Risk Assessment
- R: chip shows for every card (redundancy check too loose) (Med/Med) → unit-test subset logic with real measure/title pairs from humanize tests.
- R: icon heuristic returns wrong/empty icon (Low/Low) → default fallback; not load-bearing.
- R: layout shift breaks collapsed header alignment (Med/Low) → render icon+chip in both branches; visual cross-check vs member360.

## Rollback
- Revert card-shell + 5 callers; delete 2 new helpers. Subtitle returns.

## Next Steps
- P6 unit-tests `cardUnitChip` (subset cases) + smoke for resolveCardIcon.
