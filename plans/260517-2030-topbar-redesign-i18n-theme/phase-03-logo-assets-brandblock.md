---
phase: 3
title: "Logo assets + BrandBlock"
status: completed
priority: P1
effort: "1.5h"
dependencies: [1]
---

# Phase 3: Logo assets + BrandBlock

## Overview

Copy `dark logo.png` + `light logo.png` from `C:\Users\CPU12830-local\Downloads\Cube Logo` into `src/assets/brand/`. Update `BrandBlock` to render the correct logo per active theme, paired with the `Cube` wordmark, divider, and `vNGGAMES Data Platform` badge per Image #3.

## Requirements
- Functional: BrandBlock shows logo + "Cube" wordmark + vertical divider + "vNGGAMES Data Platform" pill, matching the proportions in Image #3. Logo image swaps based on `useTheme()`. Clicking the block routes to `/build` (unchanged).
- Non-functional: logos imported by Vite (`import lightLogo from '...'`) so they get hashed; no `public/` reliance.

## Architecture
- Logos live in `src/assets/brand/cube-logo-light.png` + `cube-logo-dark.png`. Source bytes copied from user's Downloads folder (script-friendly: a one-off `cp` from PowerShell or manual).
- `BrandBlock` uses `useTheme()`; renders `<img>` with `alt="Cube logo"`, `width=24, height=24` (eyeball-fit to the 44 px header), `aria-hidden` is OK because text "Cube" remains for screen readers.
- Badge copy comes from `t('brand.platform')` (= "vNGGAMES Data Platform" in EN; "vNGGAMES Nền tảng Dữ liệu" in VN — to keep brand "vNGGAMES" Latin).

## Related Code Files
- Create: `src/assets/brand/cube-logo-light.png`, `src/assets/brand/cube-logo-dark.png`
- Modify: `src/components/Header/brand-block.tsx`

## Implementation Steps
1. Copy both PNGs from `C:\Users\CPU12830-local\Downloads\Cube Logo` to `src/assets/brand/` (rename to kebab-case `cube-logo-light.png` + `cube-logo-dark.png`).
2. Rewrite `BrandBlock`: import both PNGs, call `useTheme()`, render `<img src={theme === 'dark' ? darkLogo : lightLogo}>` followed by `<BrandMark>Cube</BrandMark>`, divider, badge.
3. Use `useTranslation()` for the badge text.
4. Adjust container padding + gap to make the brand block compact in the 44 px header (per Image #3, brand sits flush left).
5. Update `aria-label` to `t('brand.platform')` for accessibility.
6. Manually verify in browser at light + dark + EN + VN.

## Success Criteria
- [ ] Light theme shows light logo; dark theme shows dark logo (test by flipping `data-theme` manually before phase 5 toggle exists).
- [ ] BrandBlock visually matches Image #3 left edge (orange icon + Cube + thin divider + grey vNGGAMES Data Platform badge).
- [ ] Click still navigates to `/build`.
- [ ] Vite build hashes the PNGs (verify `dist/assets/cube-logo-*.hash.png`).

## Risk Assessment
- PNG bytes are user-owned; we trust them. Verify file size is reasonable (< 50 KB each) before commit; if much larger, ask user for an SVG or compress.
- If the user later wants SVG, swap files + extension only — interface stays the same.

## Security Considerations
- None.

## Next Steps
- Phase 4 consumes the updated `BrandBlock` inside `Header.tsx`.
