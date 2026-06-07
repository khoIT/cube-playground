# Phase 1 — HTML design variants (header → KPI strip)

## Context Links
- Current action row: `src/pages/Segments/detail/detail-view.tsx:183-231`
- Current KPI strip: `src/pages/Segments/detail/components/headline-stats-row.tsx`, `stats-row.tsx`, `stats-row.module.css`
- Member360 reference (good example): `src/pages/Segments/member360/sections/dashboard-stats.tsx`
- Design rules: `docs/design-guidelines.md` + project CLAUDE.md design section
- Tokens: `src/theme/tokens.css`
- Skill: activate `huashu-design` for variant generation

## Overview
- Priority: P1 (blocks Phase 2). Status: pending.
- Design-FIRST. Produce 2–3 self-contained HTML variants of the detail header zone (breadcrumb → title row → action row → KPI strip). User picks ONE before any React work.

## Requirements
- Variants explore action-row hierarchy: primary action vs overflow/secondary grouping; icon-button vs labeled; consistent `size="small"` sizing; where Share/Refresh/Open-in-Playground/Edit/Delete sit.
- KPI strip: responsive layout, compact numbers (₫10.29B, 7.6k, 10.3M) shown, exact value implied via tooltip note.
- Faithful to tokens: inline the actual hex resolved from `tokens.css` light mode into the static HTML (HTML preview only — React impl uses `var(--…)`). One font (Inter). Spacing from the scale.
- Each variant labeled with a short rationale (when to prefer it).

## Related Code Files
- Create: `plans/260607-1331-segment-detail-ui-redesign/design/variants.html` (self-contained, all variants in one file, switchable sections).
- Read only: files listed in Context Links.

## Implementation Steps
1. Read `dashboard-stats.tsx` SectionCard + current header/KPI markup to capture real content (segment name, cubeBadge, autoPresetChip, health pill, activation chip, KPI labels).
2. Resolve token values from `tokens.css` (light mode) to use as literal colors in HTML.
3. Build `variants.html`: shared `<head>` style block; 2–3 `<section>` variants of the full header zone with realistic sample data incl. an overflow currency (₫10,286,465,000 → ₫10.29B).
4. Add a one-line rationale + tradeoff under each variant.
5. STOP. Present variants to user; await pick. Do NOT proceed to Phase 2.

## Todo List
- [ ] Capture real header/KPI content
- [ ] Resolve token hex values
- [ ] Build 2–3 variants in single HTML file
- [ ] Add rationale per variant
- [ ] Present + STOP for user pick

## Success Criteria
- `variants.html` opens standalone in a browser, renders 2–3 distinct header treatments using token-faithful colors, Inter, scale spacing.
- Compact KPI numbers visible; overflow case demonstrated.
- User has selected one variant (recorded in Phase 2 context).

## Risk Assessment
- R: variants drift from token system (Med likelihood / Med impact) → mitigate by resolving from `tokens.css`, cross-checking against dashboard-stats.
- R: user wants a 4th hybrid → acceptable; fold into Phase 2 as the chosen spec.

## Next Steps
- Blocks Phase 2. Record chosen variant id + any tweaks in phase-02 Context.
