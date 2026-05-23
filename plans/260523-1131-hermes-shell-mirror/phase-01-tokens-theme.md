---
phase: 1
title: "Tokens & Theme"
status: pending
priority: P1
effort: "20 min"
dependencies: []
---

# Phase 1: Tokens & Theme

## Context Links

- Brainstorm: [`../reports/brainstorm-260523-1054-hermes-shell-mirror.md`](../reports/brainstorm-260523-1054-hermes-shell-mirror.md) § 4.6, 6
- Spec: [`phase-00-spec/token-inventory.md`](./phase-00-spec/token-inventory.md) — exact CSS var values
- Spec: [`phase-00-spec/font-audit.md`](./phase-00-spec/font-audit.md) — League Gothic gap

## Overview

Add Hermes `--hermes-*` CSS vars (light + dark) alongside cube's existing tokens. Add `src/shell/theme.tsx` exporting `T` proxy + `Icon` + `cx`. Add League Gothic font to `index.html`. AntD overrides untouched.

## Key Insights

- Brand color identical: cube `--brand` = Hermes `--hermes-brand` = `#f05a22`. No clash.
- Dark mode selector mismatch: Hermes uses `html.dark`, cube uses `html[data-theme="dark"]`. **Use cube's selector.**
- Skip Hermes' `data-hermes-surface` / `[style*="background:#fff"]` safety-net rules (lines 129-150 of `theme-tokens.css`) — shell uses `T.surface` from day 1.
- Drop Button/Badge/Card/Input/Select/Switch/Tabs/Avatar/Kpi/SectionHeader/Sparkline from theme.tsx port — shell doesn't consume them. Saves ~400 lines vs Hermes original.

## Requirements

### Functional
- All `--hermes-*` vars resolve in light + dark modes.
- `T` proxy from `src/shell/theme.tsx` reads CSS vars via `var(--hermes-*)`.
- `Icon` component renders lucide-react icons with correct `strokeWidth=1.75` default.
- League Gothic loads from Google Fonts and renders in `T.fDisp`.

### Non-functional
- Zero changes to cube's existing `--brand`, `--bg-card`, `--text-primary`, etc.
- Zero changes to `antd-overrides.css`.
- Dark-mode toggle in cube `ThemeContext` continues to flip cube vars; now also flips `--hermes-*`.

## Architecture

```
index.html
  └─ Google Fonts <link> includes League Gothic

src/theme/tokens.css                ← APPEND (don't replace) Hermes vars
  :root { … existing cube vars … }
  :root { --hermes-n50…--hermes-topbar }      ← NEW block
  html[data-theme="dark"] { --hermes-… }      ← NEW block

src/shell/theme.tsx                 ← NEW
  export const T = { n50: 'var(--hermes-n50)', … }
  export const Icon = React.memo(…)
  export const cx = (…) => …
```

## Related Code Files

### Modify
- `index.html` — Google Fonts link (1 line edit)
- `src/theme/tokens.css` — append 2 blocks (light + dark)

### Create
- `src/shell/theme.tsx` — `T` + `Icon` + `cx` exports

### Delete
- None

## Implementation Steps

1. **Edit `index.html`** — replace existing Google Fonts link with:
   ```html
   <link href="https://fonts.googleapis.com/css2?family=League+Gothic&family=Inter:wght@400;500;600;700&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
   ```
   Verify: `document.fonts.check('400 16px "League Gothic"')` → `true` in dev console.

2. **Append to `src/theme/tokens.css`** — copy verbatim from `phase-00-spec/token-inventory.md` § "Patch to apply (verbatim values from Hermes)". The full light block (~30 vars) goes at the end of file before the dark variant.

3. **Append dark variant** — copy verbatim from `phase-00-spec/token-inventory.md` § "Dark variant". Selector = `html[data-theme="dark"]` (NOT `html.dark`).

4. **Create `src/shell/theme.tsx`** with these exports only:
   ```ts
   export const T = { n50, n100, …, n950, brand, brandHover, brandSoft, brandBorder,
     red500, red600, redSoft, blue500, blue600, blueSoft, green600, greenSoft,
     amber500, amberSoft, purple500, purpleSoft, surface, surfaceMuted, surfaceSubtle,
     shell, sidebar, topbar, fDisp, fSans, fMono } as const;
   export type LucideIcon = React.ComponentType<{...}>;
   export const Icon = React.memo<{icon, size?, color?, strokeWidth?, style?}>(…);
   export const cx = (...args) => args.filter(Boolean).join(' ');
   ```
   Source: `hermes/apps/web/src/theme.tsx` lines 17-102. Strip everything below line 102.

5. **Run `npm run dev`** — load any page → toggle dark mode → confirm:
   - `getComputedStyle(document.documentElement).getPropertyValue('--hermes-surface')` returns light value, then dark value after toggle.
   - No console errors.
   - Existing pages (Playground, Catalog, Segments) render unchanged.

6. **Run `npm run typecheck`** — must pass.

## Todo List

- [ ] Edit `index.html` Google Fonts link to include `League+Gothic`
- [ ] Append light `--hermes-*` block to `tokens.css`
- [ ] Append dark `html[data-theme="dark"]` block to `tokens.css`
- [ ] Create `src/shell/theme.tsx` with T + Icon + cx exports
- [ ] Dev start: verify League Gothic loads + dark toggle flips `--hermes-*`
- [ ] `npm run typecheck` passes

## Success Criteria

- [ ] `getComputedStyle(html).getPropertyValue('--hermes-brand')` returns `#f05a22` in light, `#f06b3a` in dark.
- [ ] Importing `{ T, Icon, cx } from '@/shell/theme'` works without TS errors.
- [ ] `T.fDisp` renders League Gothic (visual check on a test span).
- [ ] Existing Playground / Catalog / Segments pages visually unchanged.
- [ ] No new lines in `antd-overrides.css`.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Selector mismatch breaks dark mode silently | Test toggle immediately after edit; check both var sets respond |
| League Gothic CDN fails | `T.fDisp` fallback chain includes Inter — visual degrades gracefully |
| Append order matters (cube vars override `--hermes-*` or vice-versa) | They don't collide (different prefixes); order irrelevant |
| AntD theme drift | `antd-overrides.css` untouched per hard constraint |

## Security Considerations

None — pure CSS + token export changes. No storage, no auth.

## Status as of 2026-05-23

✅ DONE. All items completed:
- `index.html` updated: League Gothic added to Google Fonts link.
- `src/theme/tokens.css` appended: light + dark `--hermes-*` blocks (selector `html[data-theme="dark"]`).
- `src/shell/theme.tsx` created: `T` proxy, `Icon` component, `cx` export.

## Next Steps

Phase 2 (stores & utils) consumes `T` from `src/shell/theme.tsx`.
