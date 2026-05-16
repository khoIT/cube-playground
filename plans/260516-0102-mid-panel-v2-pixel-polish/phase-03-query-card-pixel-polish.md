---
phase: 3
title: "Query card pixel polish"
status: complete
priority: P2
effort: "2h"
dependencies: [1]
---

# Phase 3: Query card pixel polish

## Overview

Rebuild the Query card's row/pill/add-button styling to match v2 standalone CSS (`.qrow`, `.m-pill`, `.add-pill`, `.live-dot`). Updates `MemberPillRow`, the FilterRow inside `QueryStatePillBar`, the Remove-all action in inline `QueryBuilderFilters`, and the LIVE badge.

## Requirements

- Row labels: 88px column, 10.5px Geist 600 weight 0.08em letter-spacing, neutral-500.
- Pills: 28px height, white bg, neutral-200 border, 3px accent left, 8px radius, 12.5px text.
- Pill mono path: tinted chip (neutral-100 bg, 4px radius, 1px 5px padding, 10.5px Geist Mono).
- Add buttons: dashed orange border, transparent bg, brand text color. Hover: orange-soft bg, brand border.
- TIME row add label says "Add time" (not "Add").
- Remove-all: red dashed danger variant of add-pill, transparent bg, right-aligned below filter row.
- LIVE badge: emerald chip with pulsing dot keyframe animation.

**Keep current behavior:** per-member-type accent colors (`--chart-2` blue dim, `--brand` orange measure, `--chart-3` teal time, `--chart-5` purple filter). v2 uses a single dark stripe — we intentionally diverge for UX clarity. Document in code comment.

## Architecture

Touches three files; no API changes except `MemberPillRow` gains optional `addLabel` prop.

## Related Code Files

- Modify: `src/QueryBuilderV2/components/member-pill-row.tsx`
  - `Row` — use `--qrow-label-width`, `--qrow-gap`, `--qrow-padding-y`, dashed `--qrow-divider`
  - `RowLabel` — typography tokens from Phase 1
  - `PillBase` — `#fff` bg, asymmetric padding, 28px height, 8px radius, keep `$accent` left border
  - `PillText` — 500 weight, cube prefix muted via inner `<PillCube>` span
  - `PillMono` — bg-tinted chip (use `--pill-mono-*` tokens)
  - `AddButton` — dashed orange border + token-based hover
  - Add optional `addLabel?: string` prop (default "+ Add"). TIME row passes "+ Add time".
- Modify: `src/QueryBuilderV2/QueryStatePillBar.tsx`
  - Pass `addLabel="+ Add time"` to time MemberPillRow
  - `FilterRow` — match new row spec (88px label, 14px gap, 10px padding, dashed divider)
  - `LiveBadge` — replace with emerald chip + pulsing dot (keyframe `pulse 1.8s infinite`)
  - Header padding to 12px 16px; title size 14px / 600
- Modify: `src/QueryBuilderV2/QueryBuilderFilters.tsx`
  - In `inline` mode: `InlineActions` becomes right-aligned, button restyled as `.add-pill.danger`
  - Replace `<Button>` with a styled native `<button>` so it can match the dashed danger pill spec exactly

## Implementation Steps

1. **member-pill-row.tsx**
   - Replace `Row`, `RowLabel`, `PillBase`, `PillText`, `PillMono`, `AddButton` styles per spec above.
   - Split pill display into two spans: muted cube prefix + medium-weight member name.
   - `AddButton` accepts new `addLabel` (default "+ Add"). Render `<Plus size={12} /> {addLabel.replace(/^\+ /, '')}` so the icon supplies the "+".
   - Keep `kind`-based accent color via existing `KIND_META.color`.
2. **QueryStatePillBar.tsx**
   - Add `addLabel="Add time"` on the time `<MemberPillRow>` instance.
   - Update `FilterRow` styled-component grid + padding + dashed border to match `.qrow`.
   - Replace `LiveBadge` styled with v2 spec; add `@keyframes pulse` (global or scoped) and a pseudo-element `::before` dot.
   - Update `Header` padding and `Title` font-size to 14px.
3. **QueryBuilderFilters.tsx**
   - Replace the inline `<Button icon={<ClearIcon />} theme="danger">Remove All</Button>` with a styled native button using `--add-pill-danger-*` tokens.
   - Ensure `InlineActions` is `display: flex; justify-content: flex-end;` so it sits right.
4. Run `npm run typecheck` and `npx vite build`.
5. Visual check in dev server vs Image #3.

## Success Criteria

- [ ] Row label column is 88px wide
- [ ] Bottom row borders dashed (`1px dashed var(--neutral-100)`)
- [ ] Pills are 28px tall, white bg, 8px radius, with per-type accent stripe preserved
- [ ] Mono path renders as a tinted chip (not plain text)
- [ ] Add buttons have dashed orange border + hover orange-soft bg
- [ ] TIME row add button says "Add time"
- [ ] Remove-all renders as red dashed pill, right-aligned, transparent bg
- [ ] LIVE badge is emerald chip with pulsing dot
- [ ] `npx vite build` clean

## Risk Assessment

- **Layout regression** — narrow viewports may need pills to wrap. `Pills` already has `flex-wrap: wrap`; keep.
- **Cube prefix split** — `useCubeAlias` returns `alias.displayName`. Splitting into two spans must preserve `title={item.member}` accessibility on the parent.
- **Pulse keyframe global vs scoped** — define `@keyframes pulse` inside the styled-component template (scoped) to avoid collision with any existing global pulse.

## Security Considerations

None.

## Next Steps

→ Phase 4 adds the chart pane controls (independent — can run in parallel with Phase 3).
