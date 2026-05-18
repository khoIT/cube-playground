---
phase: 1
title: "Theme tokens dark-light"
status: completed
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Theme tokens dark-light

## Overview

Introduce dark-mode CSS-variable set + `ThemeProvider` that toggles `data-theme="dark|light"` on `<html>` and persists choice in localStorage. No UI affordance yet (added in phase 5). Targets all existing `var(--*)` consumers across `tokens.css`.

## Requirements
- Functional: every existing `var(--bg-*|--text-*|--border-*|--brand*|--bg-pane-rail)` token resolves to a dark-mode counterpart when `data-theme="dark"`. Light is the default. Choice survives reload. SSR-safe init (no flash) via inline script in `index.html`.
- Non-functional: no library. Pure CSS vars + a tiny React context. Antd theme via `ConfigProvider` switching `algorithm` (Antd v4 has `defaultAlgorithm` / `darkAlgorithm`).

## Architecture
- `src/theme/tokens.css` adds `:root[data-theme="dark"] { ... }` block redefining semantic tokens (neutral inversions, brand stays same, status hues nudged darker).
- `src/theme/ThemeContext.tsx` exposes `{ theme: 'light'|'dark', setTheme, toggle }`. Reads/writes `localStorage['gds-cube:theme']`. On mount sets `document.documentElement.dataset.theme`.
- `src/theme/antd-overrides.css` extends with dark-mode overrides (selector prefix `[data-theme="dark"]`).
- `src/theme/ui-kit-theme.ts` already uses CSS var references — re-renders pick up dark tokens automatically when `data-theme="dark"`. No darkRootStyles export needed.
- Pre-render guard: `index.html` `<script>` reads `localStorage['gds-cube:theme']` and stamps `data-theme` before React mounts (prevents FOUC).
- **No antd ConfigProvider algorithm swap.** antd 4.16.13 (this repo's version) has no `algorithm` prop — that's antd v5. Dark mode is delivered entirely via CSS-var redefinition + per-selector `[data-theme="dark"]` overrides in `antd-overrides.css`. <!-- Updated: Validation Session 1 - antd v4 has no darkAlgorithm; CSS-var-only approach -->



## Related Code Files
- Modify: `src/theme/tokens.css`, `src/theme/antd-overrides.css`, `src/theme/ui-kit-theme.ts`, `src/App.tsx`, `index.html`
- Create: `src/theme/ThemeContext.tsx`, `src/theme/use-theme.ts`

## Implementation Steps
1. Add the FOUC-guard inline script to `index.html` (reads `gds-cube:theme`, defaults to `light`, sets `data-theme`).
2. Extend `tokens.css` with `:root[data-theme="dark"] { ... }` block. Map neutrals: bg-app → neutral-950, bg-card → neutral-900, bg-muted → neutral-800, border-card → neutral-800, border-strong → neutral-700, text-primary → neutral-50, text-secondary → neutral-300, text-muted → neutral-500, brand-soft → rgba(240,90,34,0.12).
3. Mirror the v2 mid-panel + chart tokens (`--qrow-divider`, `--pill-mono-bg`, `--table-header-bg`, `--preagg-banner-*`) to use dark-mode equivalents.
4. Create `src/theme/ThemeContext.tsx` — Provider holds state, exposes `toggle()`. Side-effect: update `document.documentElement.dataset.theme` + write LS.
5. Create `src/theme/use-theme.ts` re-exporting `useContext(ThemeContext)`.
6. Wrap `<App>` children in `<ThemeProvider>` (in `src/index.tsx`, inside `AppContextProvider`).
7. Extend `src/theme/antd-overrides.css` with `[data-theme="dark"]` selector blocks for `ant-btn`, `ant-input`, `ant-menu-horizontal`, `ant-tabs`, `ant-modal-content`, `ant-modal-header`, `ant-dropdown-menu`, `ant-table` + thead/tbody, `ant-popover-inner`, `ant-layout`, `ant-layout-header`, `ant-card`. Mirror the existing 13 selector blocks with dark-mode hues.
8. Run `npm run typecheck` and `npm run build`.

## Success Criteria
- [ ] Setting `localStorage['gds-cube:theme'] = 'dark'` and reloading shows dark UI with no flash.
- [ ] All four primary pages (Playground/Catalog/Models/Metric) render legibly in dark mode (manual eyeball, no contrast audit yet).
- [ ] No new TS / lint errors.
- [ ] No regressions in light mode (default).

## Risk Assessment
- antd 4.16.13 has no `darkAlgorithm`; CSS-var-only approach committed. Some antd internals (tooltip arrow, picker dropdowns) may need explicit `[data-theme="dark"]` selectors beyond the 13 in the override list — flagged for phase 8 smoke testing.
- Some hard-coded hex colors exist inside component files (e.g. `metric-card-styles.ts`, `RollupDesigner`) — those won't follow theme this round. Flagged for phase 8 acceptance but NOT a blocker.

## Security Considerations
- localStorage write only; no PII.

## Next Steps
- Phase 5 consumes `useTheme()` for the toggle UI.
