---
phase: 5
title: "Results polish"
status: audit-only
priority: P3
effort: "1h"
dependencies: [1]
---

# Phase 5: Results polish

## Overview

Polish the Results card to match Image #3: audit table header background tint, refine Export CSV + Generate code button styling, verify footer typography.

## Requirements

- Tabs row already matches (verified by researcher). No change unless visual audit fails.
- Active tab underline: orange brand `#f05a22`, ~2px thickness — verified ✓.
- Table header background: currently `#dark-04.8` (neutral tint). Image #3 shows a soft orange tint on the header row. **Apply `rgba(240, 90, 34, 0.06)` if visual audit confirms; otherwise leave neutral.**
- Footer: "100 results · received N minutes ago" left + "↓ Export CSV" + "</> Generate code" buttons right.
- Footer buttons should use small outline/dashed style with leading icon, matching the overall v2 chip aesthetic.

## Related Code Files

- Inspect first (don't modify until decision): `src/QueryBuilderV2/QueryBuilderResults.tsx`
  - `TableContainer` (~line 84)
  - `TableFooter` (~line 93)
  - Column header rendering (~line 342-410 per researcher report)
- Inspect: `src/QueryBuilderV2/QueryBuilderExtras.tsx` (Order + Options buttons in the tabs right-slot)
- Likely modify (one or more):
  - Table header background fill: change `fill: '#dark-04.8'` to a brand-soft tinted value (use tasty's CSS variable interpolation or inline rgba)
  - `TableFooter`: confirm Export CSV / Generate code buttons styling. If basic outline, apply dashed border via styled wrapper.

## Implementation Steps

1. **Visual audit** — open dev server, navigate to the QueryBuilder, view a query result. Compare to Image #3 side-by-side:
   - Table header tint: orange-soft or neutral? Decide.
   - Footer button style: dashed orange border or solid outline? Decide.
   - "100 results" line vs button vertical alignment.
2. **If table header needs orange tint:** locate the header `fill` style in `QueryBuilderResults.tsx` (likely a `tasty` styled-section near the GridTable). Change to `rgba(240, 90, 34, 0.06)` — or add a new token `--table-header-bg: rgba(240, 90, 34, 0.06)` in Phase 1 (retro-add if needed) and reference it.
3. **If footer buttons need dashed:** wrap or restyle. Prefer adding a CSS class via tasty `styles` override; do NOT introduce a new styled component if a one-line tasty tweak works.
4. Verify the "100 results · received N minutes ago" left text:
   - Bold "100 results" then muted "· received N minutes ago"
   - Match font-size to Image #3 (~13px, current preset `t3m` = 13px / 600 weight — OK)
5. Run `npm run typecheck` and `npx vite build`.

## Success Criteria

- [ ] Visual audit checklist saved as a short note in this file or as a comment after the check
- [ ] Table header tint matches Image #3 (orange-soft OR explicitly documented neutral if Image differs)
- [ ] Footer Export CSV + Generate code buttons match Image #3 styling
- [ ] Result count line styled per Image #3
- [ ] `npx vite build` clean

## Risk Assessment

- **GridTable internals** — `QueryBuilderResults.tsx` is large (~700 lines). Avoid deep refactor; surgical style changes only.
- **Tasty vs styled-components** — current results table uses tasty DSL. Keep the same DSL for changes; don't mix.

## Security Considerations

None.

## Next Steps

→ Phase 6 final verification.

## Audit Decision Log (2026-05-16, auto run)

- **Table header tint**: kept neutral (`#dark-04.8`). Visual audit not run in auto mode; reverting from default would risk a regression. `--table-header-bg` token added in Phase 1 is available for a follow-up visual pass if Image #3 calls for orange-soft.
- **Footer Export CSV / Generate code buttons**: not currently wired in `TableFooter`. The Tabs right slot (`QueryBuilderExtras`) already exposes Order + Options. Introducing CSV export + Vizard trigger in the footer is a feature addition beyond the "polish" scope of this phase — punted to a follow-up.
- **Result count line**: existing `t3m` preset (13px / 600) matches Image #3 target — no change required.
