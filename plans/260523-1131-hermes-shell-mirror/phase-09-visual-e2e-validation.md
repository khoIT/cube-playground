---
phase: 9
title: "Visual & E2E Validation"
status: pending
priority: P1
effort: "90 min"
dependencies: [1, 2, 3, 4, 5, 6, 7, 8]
---

# Phase 9: Visual & E2E Validation

## Context Links

- Brainstorm § 5 Phase 8-9, § 7 Success Criteria
- Visual baseline: [`phase-00-spec/huashu-prototype.html`](./phase-00-spec/huashu-prototype.html)
- Hermes running locally as reference (port 5173 via `pnpm dev`)

## Overview

Gate the port behind two automated checks: (1) Playwright pixel diff for sidebar + topbar + segments library vs Hermes screenshots, <2% diff in light + dark @ 1440×900; (2) Playwright E2E smoke on every cube route asserting no console errors + all CTAs reachable + no functional regressions.

## Key Insights

- Hermes screenshots captured by booting Hermes locally (`cd ~/Documents/code/hermes && pnpm dev`) and Playwright grabbing target surfaces.
- Pixel-diff target: `playwright-core` built-in `expect(locator).toHaveScreenshot()` with `maxDiffPixelRatio: 0.02`.
- E2E scope: assert page renders + no console.error + sidebar visible + topbar visible + specific CTAs clickable (per route).
- Cube already ships vitest; **Playwright is new** — install in this phase. Pin to a single browser (Chromium) for speed.
- Headless + screenshot mode CI-able; mask volatile content (timestamps, live count) to avoid false negatives.

## Requirements

### Functional
- Playwright config tuned: 1440×900 viewport, Chromium only, retries 0, deterministic timezone.
- Pixel-diff baseline screenshots captured from Hermes (committed under `tests/visual/baseline-hermes/`).
- Diff specs run cube against each baseline; fail if `maxDiffPixelRatio > 0.02`.
- E2E smoke specs cover: `/build`, `/chat`, `/catalog/data-model`, `/catalog/metrics`, `/segments`, `/segments/:id`, `/data-model/new`, `/catalog/digest`, `/catalog/notifications`, `/catalog/saved-views`, `/catalog/workspaces`, `/segments/identity-map`.
- For each route: no console errors, sidebar + topbar present, all sidebar tabs clickable.
- Dark mode: toggle once → re-screenshot 3 anchor surfaces.

### Non-functional
- Total run < 5 min on CI.
- Test files ≤ 200 lines each.

## Architecture

```
tests/
├─ visual/
│  ├─ baseline-hermes/              ★ Hermes reference screenshots (commit)
│  │   ├─ sidebar-light-1440x900.png
│  │   ├─ sidebar-dark-1440x900.png
│  │   ├─ topbar-light-1440x900.png
│  │   ├─ topbar-dark-1440x900.png
│  │   ├─ segments-library-light-1440x900.png
│  │   └─ segments-library-dark-1440x900.png
│  ├─ sidebar-pixel-diff.spec.ts
│  ├─ topbar-pixel-diff.spec.ts
│  └─ segments-library-pixel-diff.spec.ts
└─ e2e/
   ├─ shell-smoke.spec.ts            ← sidebar/topbar present on every route
   ├─ navigation-smoke.spec.ts       ← click each sidebar tab, expect URL change
   ├─ playground-functions.spec.ts   ← query builder still works on /build
   ├─ catalog-functions.spec.ts      ← data-model + metrics-catalog browse
   ├─ segments-library.spec.ts       ← search, filter, group-by, multi-select
   ├─ segments-detail.spec.ts        ← all 5 tabs render, Activate modal opens
   ├─ dark-mode.spec.ts              ← toggle flips both var sets
   └─ root-redirect.spec.ts          ← / → /build, /catalog → /catalog/data-model

playwright.config.ts                  ★ NEW
```

## Related Code Files

### Create
- `playwright.config.ts`
- `tests/visual/sidebar-pixel-diff.spec.ts`
- `tests/visual/topbar-pixel-diff.spec.ts`
- `tests/visual/segments-library-pixel-diff.spec.ts`
- `tests/visual/baseline-hermes/*.png` (capture script + commit)
- `tests/e2e/shell-smoke.spec.ts`
- `tests/e2e/navigation-smoke.spec.ts`
- `tests/e2e/playground-functions.spec.ts`
- `tests/e2e/catalog-functions.spec.ts`
- `tests/e2e/segments-library.spec.ts`
- `tests/e2e/segments-detail.spec.ts`
- `tests/e2e/dark-mode.spec.ts`
- `tests/e2e/root-redirect.spec.ts`
- `scripts/capture-hermes-baseline.ts` — boots Hermes, captures the 6 baseline screenshots

### Modify
- `package.json` — add Playwright dev dependency + `npm run e2e` + `npm run e2e:visual`
- `.gitignore` — add `playwright-report/` + `test-results/` + `tests/visual/__diff_output__/`

### Delete
- None

## Implementation Steps

1. **Install Playwright**:
   ```bash
   npm install --save-dev --legacy-peer-deps @playwright/test
   npx playwright install chromium
   ```

2. **Create `playwright.config.ts`**:
   ```ts
   import { defineConfig, devices } from '@playwright/test';
   export default defineConfig({
     testDir: './tests',
     timeout: 30_000,
     retries: 0,
     reporter: [['list']],
     use: {
       baseURL: 'http://localhost:3000',
       viewport: { width: 1440, height: 900 },
       locale: 'en-US',
       timezoneId: 'Asia/Saigon',
       ...devices['Desktop Chrome'],
     },
     webServer: {
       command: 'npm run dev',
       url: 'http://localhost:3000',
       reuseExistingServer: !process.env.CI,
       timeout: 60_000,
     },
   });
   ```

3. **Capture Hermes baselines** — write `scripts/capture-hermes-baseline.ts`:
   - Boot Hermes in a child process: `pnpm --filter @hermes/web dev` on port 5173.
   - Use Playwright to screenshot:
     - `aside[role="..."]` → sidebar-light + sidebar-dark
     - `header[role="..."]` → topbar-light + topbar-dark
     - `/segments` page → segments-library-light + segments-library-dark
   - Save PNGs into `tests/visual/baseline-hermes/`.
   - Run once, commit PNGs.

4. **Write pixel-diff specs**:
   ```ts
   // tests/visual/sidebar-pixel-diff.spec.ts
   import { test, expect } from '@playwright/test';
   import fs from 'fs';
   import path from 'path';

   for (const theme of ['light', 'dark'] as const) {
     test(`sidebar ${theme} matches Hermes baseline within 2%`, async ({ page }) => {
       await page.goto('/');
       if (theme === 'dark') await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
       const sidebar = page.locator('aside').first();
       const baseline = fs.readFileSync(path.resolve(__dirname, `baseline-hermes/sidebar-${theme}-1440x900.png`));
       await expect(sidebar).toHaveScreenshot(`sidebar-${theme}-cube.png`, { maxDiffPixelRatio: 0.02 });
       // For cross-repo compare, use pixelmatch directly:
       // const cubeShot = await sidebar.screenshot();
       // const diff = pixelmatch(cubeShot, baseline, ...);
       // expect(diff / total).toBeLessThan(0.02);
     });
   }
   ```
   Same pattern for `topbar-pixel-diff.spec.ts` and `segments-library-pixel-diff.spec.ts`.

5. **Write E2E smoke specs**:
   - `shell-smoke.spec.ts`: iterate every route, assert `aside` + `header[sticky]` present, console.error count == 0.
   - `navigation-smoke.spec.ts`: click each sidebar tab, assert URL changes correctly.
   - `playground-functions.spec.ts`: open `/build`, select a measure, run query, assert results table renders.
   - `catalog-functions.spec.ts`: open `/catalog/data-model`, click a cube card, assert detail panel renders.
   - `segments-library.spec.ts`: open `/segments`, type into search → row count drops, click filter pill, click first row → navigates to detail.
   - `segments-detail.spec.ts`: open `/segments/{first-id}`, click each tab → body renders, open Activate modal → close.
   - `dark-mode.spec.ts`: toggle once, assert `document.documentElement.getAttribute('data-theme') === 'dark'`, verify `--hermes-surface` computed style flips.
   - `root-redirect.spec.ts`: visit `/`, assert URL becomes `/build`; visit `/catalog`, assert URL becomes `/catalog/data-model`.

6. **Run locally**:
   ```bash
   npm run e2e          # all e2e specs
   npm run e2e:visual   # only visual diff specs
   ```

7. **Iteration loop** if pixel diff > 2%:
   - Open `playwright-report/` HTML output → see overlay diff highlights.
   - Identify which surface drifted; consult `phase-00-spec/pixel-spec.md` for correct value.
   - Fix in earlier phase, re-run.

8. **Iteration loop** if E2E fails:
   - Read failure message → identify which functionality broke.
   - Fix in originating phase, re-run.

9. **CI integration** (optional, deferred to a follow-up PR):
   - GitHub Actions: install Playwright cache, run `npm run e2e` on every PR.

## Todo List

- [ ] `npm install --save-dev @playwright/test`; `npx playwright install chromium`
- [ ] Create `playwright.config.ts`
- [ ] Write & run `scripts/capture-hermes-baseline.ts`; commit 6 PNG baselines
- [ ] Write 3 pixel-diff specs (sidebar, topbar, segments-library)
- [ ] Write 8 E2E specs (shell-smoke, navigation, playground, catalog, segments-library, segments-detail, dark-mode, root-redirect)
- [ ] `package.json` scripts: `e2e`, `e2e:visual`, `e2e:update-snapshots`
- [ ] Local run: all specs green; pixel diffs < 2%
- [ ] If any spec fails → fix in earlier phase, rerun

## Success Criteria

- [ ] All 3 visual diff specs pass with `maxDiffPixelRatio < 0.02`.
- [ ] All 8 E2E specs pass with zero console errors.
- [ ] `/` redirects to `/build` (verified).
- [ ] Dark-mode toggle flips both cube and `--hermes-*` vars (verified).
- [ ] Every existing vitest spec still passes (`npm run test`).
- [ ] No file in `src/components/Header/` (except `user-menu.tsx` used by avatar-menu).
- [ ] No `IndexPage` references in code.
- [ ] `npm run build` produces clean dist with no warnings about unused imports.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Hermes-vs-cube screenshot dimensions differ (Hermes sidebar 260px, ours too — should match) | Capture both with `viewport: 1440×900`; both use 260px sidebar; if diff: read `pixel-spec.md` again |
| Pixel diff fails on font kerning (anti-aliasing) | Mask text regions in diff: use `clip` option for layout-only diff, separate text-diff spec accepts 5% |
| Live-polling timestamps cause flaky diffs | Mask `[data-testid="last-refreshed"]` regions before screenshot |
| Hermes baseline drifts if Hermes evolves | Recapture baselines only when explicitly approved; commit them, don't auto-update |
| Playwright install slow on CI | Cache `~/.cache/ms-playwright`; deferred until Phase 9 ships |
| AntD modal pixel diff noise | Don't diff modals/dropdowns — diff sidebar + topbar + segments library only |

## Security Considerations

- E2E specs don't run with real auth tokens; cube falls back to anon flow.
- Hermes baselines contain only public UI surfaces; no sensitive data captured.

## Next Steps

Plan complete. After Phase 9 green:
- Optional follow-up: CI integration (GitHub Actions Playwright job).
- Optional follow-up: Storybook for shell primitives.
- Optional follow-up: Recapture baselines if/when Hermes evolves.
