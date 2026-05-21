---
phase: 9
title: "Dark mode pass"
status: pending
priority: P3
effort: "0.5d"
dependencies: [1, 3, 5, 6, 7, 8]
brainstormId: P6.5
---

# Phase 9 (P6.5): Dark mode pass

## Context Links

- Brainstorm: `../reports/brainstorm-260520-2311-segments-first-class-redesign.md` §15 (decision: P6.5 follow-up)
- DS dark-mode spec: `../reports/VNGGames-Player-Hub/VNGGames-Player-Hub-Design-System.md` §Semantic Tokens → Dark mode

## Overview

Audit + ship dark mode across all redesigned surfaces. DS already inverts cleanly via `.dark` token block; Header already has `theme-toggle.tsx`. This phase is a regression sweep, not a rebuild.

## Key Insights

- Most components already use `var(--token)` so theme switch propagates for free.
- Risk surface is hand-coded inline-style colors (`rgba(0,0,0,0.05)`, `#fff`) that won't invert. Find + replace with tokens.
- Charts (sparkline, size trend) use `--chart-1..5` which stay constant across themes per DS — verify visibility on dark backgrounds.
- Shadow scale is "invisible in dark mode" per DS — verify no card disappears into background.
- Phase 9 runs AFTER all other phases land so the audit catches new code from Phase 3/5/6/7.

## Requirements

**Functional**
- Dark mode renders without visual regressions across all redesigned surfaces:
  - Header + GamePicker
  - Segments Library (incl. filter pills, table, destination chips, sparklines)
  - Segments Detail (all 5 tabs)
  - Editor workspace (3 columns + steps + preview)
  - Push-modal (all 3 tabs)
  - Catalog + NewMetric (post-Phase-8 polish)
- Theme toggle in Header works (already wired); persistence via localStorage already implemented.
- Tokens that exist in light but not dark get a dark fallback (`tokens.css` `.dark` block).
- Charts visible on dark background (orange #f05a22 retains contrast; verify others).

**Non-functional**
- LOC ≤ 150 (mostly token additions + targeted style fixes).
- No new components.

## Architecture

Single-file audit:
```
src/theme/tokens.css                    — verify .dark block covers all tokens added in Phases 1-8
src/pages/Segments/segments.module.css  — scan for hand-coded colors; swap to tokens
src/pages/Catalog/*.css (or styled)     — same
src/QueryBuilderV2/NewMetric/...        — same
```

Dev tool: open every screen with `.dark` toggled, eyeball + DevTools-pick any element with non-token colors.

## Related Code Files

**Modify** (scope determined by audit; expected ~5-10 files)
- `/Users/lap16299/Documents/code/cube-playground/src/theme/tokens.css` (fill `.dark` block gaps for new tokens from Phase 1)
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/segments.module.css` (token sweep)
- Any Catalog or NewMetric CSS files surfacing hand-coded colors
- Inline-style audit across the 9-phase touched files (search `style={{ color:` / `background:` for literal hex/rgba)

**Create** — none.
**Delete** — none.

## Implementation Steps

1. **Toggle** — Verify `theme-toggle.tsx` in Header switches `<html>.dark` class. Document keyboard shortcut if absent.
2. **Token gap audit** — Diff `:root {}` vs `.dark {}` in tokens.css. Any token added in Phases 1-8 (semantic `*-soft`/`*-ink`, chart palette, font tokens) must have a `.dark` equivalent OR be explicitly safe across themes.
3. **Inline color audit** — Grep for hand-coded colors in touched files:
   ```bash
   grep -rE "rgba?\(|#[0-9a-fA-F]{3,8}" src/pages/Segments/ src/pages/Catalog/ src/components/Header/ src/QueryBuilderV2/NewMetric/
   ```
   Replace each hit with a token; if no suitable token, add one + use it.
4. **Visual sweep** — Open each redesigned screen with dark mode on. Look for:
   - Cards disappearing into background
   - Text on illegible background
   - Chart lines invisible
   - Focus rings missing
   - Destination chip backgrounds wrong
5. **Sparkline contrast** — Verify chart-1 orange visible on dark background; adjust opacity of area-gradient fallback if needed.
6. **Avatar gradients** — `linear-gradient(135deg, #f05a22, #dc2626)` in mockup — verify legibility on dark; substitute neutral fallback if needed.
7. **Shadow regression** — Per DS shadows-invisible-in-dark — verify cards have border-strong as their separator instead of shadow.
8. **Manual QA** — Walk every screen + every interactive state (hover, focus, active, disabled) in dark mode.

## Todo List

- [ ] Verify theme-toggle still works
- [ ] Diff `:root` vs `.dark` in tokens.css; fill gaps
- [ ] Grep hand-coded colors in touched files; swap to tokens
- [ ] Visual sweep: every redesigned screen in dark mode
- [ ] Sparkline contrast check
- [ ] Avatar gradient legibility check
- [ ] Shadow → border fallback verification
- [ ] Manual QA: every screen + every interactive state

## Success Criteria

- [ ] All 9 redesigned screens render without visual regressions in dark mode.
- [ ] No console warnings or color contrast violations (axe DevTools).
- [ ] All hand-coded inline colors replaced with tokens.
- [ ] Theme toggle persists across reload.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Token gap in dark block causes "invisible" elements | M | Token diff audit catches before manual sweep; visual sweep catches the rest |
| Avatar gradients clash with dark background | L | Fallback to neutral-700 / neutral-800 stops; gradient stays "decoration only" |
| Chart legibility on dark | L | Test once; DS palette is contrast-safe by spec |
| New code from Phase 7 (push modal) introduces non-token colors after audit | L | Run audit twice: once mid-phase, once end-of-phase pre-merge |
| Time-budget overrun if regressions are many | M | Cap fix list; remaining items become a P9.1 follow-up rather than blocking |

## Security Considerations

None. Visual-only.

## Next Steps

Plan complete. Optional: Phase 7 deferred work (real CDP wiring acceptance test once backend ready). Phase 10+ → see separate brainstorm for Playground v3.
