import { test, expect } from '@playwright/test';

/**
 * Pins existing-screen visual state so future PRs don't accidentally regress
 * the polish pass applied during P0. Baselines for these are captured from
 * the running app (post-theme-apply) — NOT from the mock.
 *
 * Generate first-time baselines via: npm run test:visual -- --update-snapshots
 * Review the resulting PNGs manually before committing.
 */

const SCREENS: { id: string; path: string }[] = [
  { id: 'home', path: '/' },
  { id: 'playground', path: '/playground' },
  { id: 'data-model', path: '/data-model' },
  { id: 'settings', path: '/settings' },
];

for (const screen of SCREENS) {
  test(`polish: ${screen.id}`, async ({ page }) => {
    await page.goto(screen.path, { waitUntil: 'networkidle' });
    await expect(page).toHaveScreenshot(`${screen.id}.png`, { fullPage: true });
  });
}
