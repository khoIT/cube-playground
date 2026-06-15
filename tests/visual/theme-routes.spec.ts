import { test, expect, Page } from '@playwright/test';
import { VISUAL_ROUTES, THEMES, GLOBAL_MASK } from './routes.manifest';

/**
 * Theme visual-regression gate (Phase 0 of the theme-centralization plan).
 *
 * Captures every manifest route in BOTH light and dark against committed
 * baselines. This is the enforceable form of the hard constraint "the UI stays
 * pixel-intact in both themes" — every later refactor phase must keep this green
 * (or intentionally re-capture with a documented rationale).
 *
 * Determinism levers:
 *  - theme is seeded pre-boot (localStorage mirror) AND force-set on the
 *    documentElement after hydration, since server-pref reconciliation can
 *    otherwise flip it. The rendered CSS keys off `[data-theme]`, so forcing the
 *    attribute is the reliable lever for a color gate.
 *  - transitions/animations/caret are killed via an injected stylesheet.
 *  - live-data regions (charts/canvas/tickers) are masked (see GLOBAL_MASK +
 *    per-route mask) so real data churn doesn't fail the color gate.
 *
 * Requires the local dev stack running (vite :3000 → fastify :3004 → cube :4000)
 * with auth bypassed (bootstrap admin). Baselines: `npm run test:visual:update`.
 */

const NO_MOTION_CSS =
  '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';

async function applyTheme(page: Page, theme: string): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
    try {
      window.localStorage.setItem('gds-cube:theme', t);
    } catch {
      /* privacy mode — attribute alone still drives the CSS */
    }
  }, theme);
}

test.describe('theme visual gate', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const route of VISUAL_ROUTES) {
    for (const theme of THEMES) {
      test(`${route.id} · ${theme}`, async ({ page }) => {
        // Seed the theme before any app script runs so first paint is correct.
        await page.addInitScript((t) => {
          try {
            window.localStorage.setItem('gds-cube:theme', t);
          } catch {
            /* ignore */
          }
        }, theme);

        await page.goto(`/#${route.hash}`, { waitUntil: 'networkidle' });

        // Re-assert the theme after hydration (server prefs may have reconciled
        // the mirror) and freeze motion.
        await applyTheme(page, theme);
        await page.addStyleTag({ content: NO_MOTION_CSS });

        if (route.waitFor) {
          await page.waitForSelector(route.waitFor, { timeout: 10_000 });
        }
        // Let layout settle (lazy panels, fonts) before snapshotting.
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);

        const maskSelectors = [...GLOBAL_MASK, ...(route.mask ?? [])];
        const mask = maskSelectors.map((s) => page.locator(s));

        await expect(page).toHaveScreenshot(`${route.id}__${theme}.png`, {
          fullPage: true,
          mask,
        });
      });
    }
  }
});
