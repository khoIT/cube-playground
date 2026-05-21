---
phase: 1
title: Token audit
status: completed
priority: P1
effort: 0.5d
dependencies: []
brainstormId: P0
---

# Phase 1 (P0): Token audit

## Context Links

- Brainstorm: `../reports/brainstorm-260520-2311-segments-first-class-redesign.md` §4.1
- Mockup: `../visuals/segments-first-class-mockup.html`
- DS source: `../reports/VNGGames-Player-Hub/VNGGames-Player-Hub-Design-System.md`

## Overview

Align `src/theme/tokens.css` to the VNGGames Player Hub DS values. Foundation phase. Parallel-safe with Phase 2. Token sheet today already mirrors the DS ~90% — this is an alignment audit, not a swap.

## Key Insights

- `--brand` = `--orange-600` = `#f05a22` already matches.
- Deltas vs DS: `--orange-700` (`#c2410c` → `#f54a00`), `--success` (`#009688` → `#059669`), font stack (Geist-only → Inter body + Geist alt + Geist Mono).
- `--chart-1..5` not defined; needed by Library trend SVGs (P3) and Detail Monitor (P5).
- antd Button radius is 8px by default; DS wants pill (9999). Single-file override in `theme/antd-overrides.css`.
- League Gothic SKIPPED (brainstorm §16 decision). Use Inter Semibold for page titles.

## Requirements

**Functional**
- Align 6 token values to DS exact hex.
- Add `--chart-1..5` palette tokens.
- Add Inter to Google Fonts load + `--font-sans` priority.
- Pill button radius applies to all antd `Button` variants.

**Non-functional**
- No visual regressions on pages not in scope (Playground, NewMetric).
- Token change diff ≤ 200 LOC across `tokens.css` + `antd-overrides.css`.

## Architecture

Tokens live in `src/theme/tokens.css`, loaded once at app bootstrap from `src/App.tsx`. All component styles already use `var(--token)`, so token edits propagate automatically. antd component radii are overridden in `src/theme/antd-overrides.css` (already exists per `App.tsx` import).

Font loading happens via Google Fonts `<link>` in `index.html`. Add Inter family alongside existing Geist + Geist Mono.

## Related Code Files

**Modify**
- `/Users/lap16299/Documents/code/cube-playground/src/theme/tokens.css`
- `/Users/lap16299/Documents/code/cube-playground/src/theme/antd-overrides.css`
- `/Users/lap16299/Documents/code/cube-playground/index.html` (Google Fonts link)

**Create** — none.
**Delete** — none.

## Implementation Steps

1. Edit `tokens.css`: change `--orange-700` to `#f54a00`, `--success` to `#059669`. Add `--success-soft`/`--success-ink`, `--destructive-soft`/`--destructive-ink`, `--warning-soft`/`--warning-ink`, `--info-soft`/`--info-ink` for Badge variants.
2. Add `--chart-1: #f05a22; --chart-2: #3f8dff; --chart-3: #009689; --chart-4: #f59e0b; --chart-5: #a855f7;` block.
3. Update `--font-sans` to `'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif`. Add `--font-alt: 'Geist', 'Inter', ui-sans-serif, system-ui, sans-serif` for headings/labels. Keep `--font-mono` (Geist Mono).
4. Edit `index.html` Google Fonts link to include `Inter:wght@400;500;600;700` alongside existing Geist families.
5. Edit `antd-overrides.css`: target `.ant-btn` and variants → `border-radius: var(--pill, 9999px) !important;`. Add allow-list scoping if any antd component depends on default radius (e.g. `.ant-modal` corners — keep 16px).
6. Visual sanity sweep: open Playground, Catalog, Segments Library, NewMetric — confirm no obvious regression.

## Todo List

- [x] `tokens.css` value alignment (orange-700, success, semantic *-soft/*-ink scales)
- [x] `tokens.css` add `--chart-1..5` (pre-existing; verified)
- [x] `tokens.css` add `--font-alt` + flip `--font-sans` to Inter
- [x] `index.html` Google Fonts: add Inter
- [x] `antd-overrides.css` pill button radius override (already in place via `--radius-pill`)
- [ ] Visual sanity sweep across all 4 nav pages (manual QA — pending)

## Success Criteria

- [ ] All 5 chart tokens render correctly in a quick test SVG.
- [ ] antd primary Button across the app is pill-shaped.
- [ ] Inter is the rendered body font (DevTools Computed > font-family).
- [ ] No console errors. No visual regressions outside Segments.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Pill radius cascades to antd Modal close-X / Segmented controls | M | Scope the override selector to `.ant-btn` only; allow-list `.ant-btn-circle` for icon buttons; verify Modal in Push-modal screen still has 16px radius |
| `--success` color shift surprises StatusPill consumers (current uses teal #009688) | L | Visual diff on segments library — Fresh dot/badge stays clearly green |
| Geist → Inter shift changes line metrics / wraps | L | Both are tight modern sans; spot-check page titles + table cells |
| Inter font network load adds FCP delay | L | Already loaded via preconnect; just adding a family — minor weight |

## Security Considerations

None. CSS-only change.

## Next Steps

Unblocks: Phase 3 (Library uses chart-1 sparkline), Phase 5 (Monitor chart), Phase 8 (Catalog pill buttons). Phase 9 (Dark mode) audits tokens post-phase.
