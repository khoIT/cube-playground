import { test, expect } from '@playwright/test';

/**
 * Renders the real /segments routes (dev server) with deterministic fixture
 * data and compares against PNGs in tests/visual/baselines/.
 *
 * Fixtures endpoint (added in same phase, dev-only): GET /api/__fixtures__/segments
 * seeds an in-memory state via X-Fixture-Reset header before each screen.
 *
 * Acceptance threshold: maxDiffPixelRatio 0.02 (configured in playwright.config.ts).
 */

const ROUTES: { id: string; path: string }[] = [
  { id: 'library', path: '/segments' },
  { id: 'detail-overview', path: '/segments/seg_fixture/overview' },
  { id: 'detail-engagement', path: '/segments/seg_fixture/engagement' },
  { id: 'detail-monetization', path: '/segments/seg_fixture/monetization' },
  { id: 'detail-retention', path: '/segments/seg_fixture/retention' },
  { id: 'detail-sample-users', path: '/segments/seg_fixture/sample-users' },
  { id: 'detail-predicate', path: '/segments/seg_fixture/predicate' },
  { id: 'editor', path: '/segments/seg_fixture/edit' },
  { id: 'push-flow', path: '/playground?fixture=push' },
];

test.beforeAll(async ({ request }) => {
  // Best-effort fixture seed. Endpoint added in same phase under server/src/routes/__fixtures__.ts.
  try {
    await request.post('/api/__fixtures__/segments', { headers: { 'X-Fixture-Reset': '1' } });
  } catch {
    /* dev-only endpoint may be absent in some test runs */
  }
});

for (const route of ROUTES) {
  test(`screen: ${route.id}`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'networkidle' });
    await expect(page).toHaveScreenshot(`${route.id}.png`, { fullPage: true });
  });
}
