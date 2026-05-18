# Phase 01 — Tokenisation: Design Tokens, Geist Font, antd Overrides

## Context Links

- Mockup tokens: `plans/reports/research-260515-1254-ui-revamp-stitch-standalone-mockup.md` §"Mockup Anatomy"
- antd override strategy: same report §Risks R3 / Decision D7
- Geist font: same report Risks R2 / Decision D8
- Files today: `src/index.css` (if present), `index.html`, `vite.config.ts`

## Overview

- **Priority:** P1 (foundation; blocks all visual phases)
- **Status:** completed
- **Brief:** Drop in the mockup's CSS custom-property scale, load Geist font, and add a thin antd 4 override stylesheet. No component rewrites.

## Key Insights

- Mockup uses Tailwind v4 neutral scale + brand orange `#f05a22`. All semantic colors reduce to these tokens.
- antd 4 uses Less variables compiled into the CSS bundle. Recompiling Less is slow + brittle → override the rendered class names with our own stylesheet (D7).
- UI-kit `@cube-dev/ui-kit@0.52.3` exposes a `Root` element with a `styles` prop / theme — feed it the same tokens (mockup §Risks R4).
- Geist is OFL 1.1, ships from Google Fonts CDN — no licensing block.

## Requirements

**Functional**
- All mockup tokens available as `var(--token-name)` globally.
- `font-family` defaults to Geist sans; monospace defaults to Geist Mono.
- antd `Button` / `Input` / `Menu` / `Tabs` / `Modal` / `Dropdown` / `Table` adopt brand orange + neutral palette + 8px radii.
- UI-kit `Card`, `Button`, `Flex` inherit the same palette via Root theme.

**Non-functional**
- Zero new runtime dependencies (Geist loaded via CDN `<link>`).
- Override stylesheet < 200 LOC.
- No FOUC: font `display=swap` + system fallback chain.

## Architecture

```
index.html  ── <link rel="stylesheet" href="https://fonts.googleapis.com/...Geist...">
            └─ <link rel="stylesheet" href="/src/theme/tokens.css">

src/main.tsx ── imports order matters:
   1. antd/dist/antd.min.css                       (vendor)
   2. src/theme/tokens.css                          (CSS vars only)
   3. src/theme/antd-overrides.css                  (target antd class names)
   4. src/theme/ui-kit-theme.ts → Root styles prop  (UI-kit)
   5. App.tsx
```

Token scale (excerpt — finalise from mockup CSS dump):

```css
:root {
  --neutral-50: #fafafa;
  --neutral-100: #f5f5f5;
  --neutral-200: #e5e5e5;
  --neutral-300: #d4d4d4;
  --neutral-500: #737373;
  --neutral-700: #404040;
  --neutral-900: #171717;
  --neutral-950: #0a0a0a;

  --orange-50:  #fff7ed;
  --orange-500: #f97316;
  --orange-600: #f05a22;  /* brand */
  --orange-700: #c2410c;

  /* semantic */
  --brand: var(--orange-600);
  --bg-app: var(--neutral-50);
  --bg-card: #ffffff;
  --border-card: var(--neutral-200);
  --text-primary: var(--neutral-900);
  --text-muted: var(--neutral-500);
  --radius-card: 12px;
  --radius-pill: 8px;
  --shadow-xs: 0 1px 2px rgba(0,0,0,.04);

  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, monospace;

  --chart-1: #f05a22; --chart-2: #3f8dff; --chart-3: #009689;
  --chart-4: #f59e0b; --chart-5: #a855f7;
}
```

## Related Code Files

**Create**
- `src/theme/tokens.css` — CSS custom-property scale
- `src/theme/antd-overrides.css` — class-name overrides for antd 4
- `src/theme/ui-kit-theme.ts` — Root `styles` prop object for `@cube-dev/ui-kit`

**Modify**
- `index.html` — add Google Fonts `<link>` for Geist + Geist Mono
- `src/main.tsx` (or wherever the React tree mounts) — import token + override CSS in correct order; wrap Root with new theme
- `src/index.css` (if exists) — strip global rules now superseded by tokens

**Delete**
- Any `--dark-02-color` / legacy custom-prop definitions superseded by `--neutral-*`

## Implementation Steps

1. Open mockup HTML in `/Users/lap16299/Downloads/Cube Playground _standalone_.html`. Grep `<style>` block, extract every `--*` and chart palette value. Dump verbatim into `src/theme/tokens.css`.
2. Add Google Fonts link to `index.html` `<head>`:
   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
   ```
3. Set body `font-family: var(--font-sans)` in `tokens.css`.
4. Create `src/theme/antd-overrides.css`. Override only the visible surfaces we use: `.ant-btn-primary`, `.ant-btn`, `.ant-input`, `.ant-menu-horizontal`, `.ant-tabs-tab`, `.ant-tabs-tab-active`, `.ant-modal-content`, `.ant-dropdown-menu`, `.ant-table`. Map color/border-radius/font to tokens.
5. Create `src/theme/ui-kit-theme.ts` exporting a `Styles` object for `Root`:
   ```ts
   export const rootStyles = {
     fontFamily: 'var(--font-sans)',
     '--primary-color': 'var(--brand)',
     // …extend as UI-kit token names are discovered
   };
   ```
6. Update `main.tsx` import order. Wrap UI-kit `Root` with `styles={rootStyles}`.
7. Run `npm run dev`. Open `/build`. Sanity-check: brand orange visible on Run query button, Geist applied to body, antd Menu uses neutral palette.
8. Run `npm run build` — ensure no TS error from `Styles` typing.

## Todo List

- [ ] Extract token values from mockup `<style>` block
- [ ] Create `src/theme/tokens.css`
- [ ] Add Geist `<link>` to `index.html`
- [ ] Create `src/theme/antd-overrides.css`
- [ ] Create `src/theme/ui-kit-theme.ts`
- [ ] Wire imports in `main.tsx` in correct order
- [ ] Pass `styles={rootStyles}` to UI-kit `Root`
- [ ] Visual smoke: brand orange, Geist applied
- [ ] `npm run build` passes

## Success Criteria

- `getComputedStyle(document.body).fontFamily` resolves to a Geist-led string.
- Run Query button background ≈ `#f05a22`.
- antd `Menu` border-bottom is neutral, not antd-blue.
- No console warnings about missing CSS vars.
- Build green.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| antd Less variables override our tokens | Medium | Medium | Use `!important` on specific overrides; scope to outer selectors |
| Geist CDN blocked in some networks | Low | Low | Robust fallback chain to system fonts |
| UI-kit ignores Root `styles` for some primitives | Medium | Low | Defer to a `styled-components` `ThemeProvider` for hold-outs in later phases |
| Token explosion — adding every mockup var | High | Low | Start with ~30 essentials; extend per phase |

## Security Considerations

- Google Fonts CDN = third-party resource. Same risk surface as existing dev setup. No new auth surface.

## Rollback

- Revert single commit. Tokens + antd overrides + Geist `<link>` are additive — no behavioural change to remove.

## Next Steps

Unblocks phases 2 (Top Bar), 3 (Sidebar), 4 (Pill Bar), 5 (Results+Chart). All consume the tokens.

## Unresolved Questions

- Does UI-kit `Root.styles` accept CSS vars natively, or must we map to its own token names? Discover during step 5.

Status: DONE
