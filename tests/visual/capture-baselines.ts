/**
 * Renders the vendored mock (tests/visual/mock-fork/Cube Segment.html) headless,
 * drives each screen state via the in-mock TweaksPanel quick-nav, screenshots
 * at both viewports, and writes PNGs into tests/visual/baselines/.
 *
 * Run via: npm run visual:capture-baselines
 */

import { chromium, devices, Browser, Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MOCK_HTML = path.join(__dirname, 'mock-fork', 'Cube Segment.html');
const BASELINES_DIR = path.join(__dirname, 'baselines');

interface ScreenState {
  id: string;
  /** Tweaks panel button data-state or text used to navigate to this state. */
  navAction: (page: Page) => Promise<void>;
}

const SCREEN_STATES: ScreenState[] = [
  { id: 'push-flow', navAction: nav('Push flow') },
  { id: 'library', navAction: nav('Library') },
  { id: 'detail-overview', navAction: nav('Detail · Overview') },
  { id: 'detail-engagement', navAction: nav('Detail · Engagement') },
  { id: 'detail-monetization', navAction: nav('Detail · Monetization') },
  { id: 'detail-retention', navAction: nav('Detail · Retention') },
  { id: 'detail-sample-users', navAction: nav('Detail · Sample Users') },
  { id: 'detail-predicate', navAction: nav('Detail · Predicate') },
  { id: 'editor', navAction: nav('Editor') },
];

function nav(buttonText: string) {
  return async (page: Page) => {
    const btn = page.getByRole('button', { name: buttonText });
    if (await btn.count()) {
      await btn.first().click();
      await page.waitForTimeout(150);
    } else {
      console.warn(`[capture] No nav button found for "${buttonText}" — falling back to default screen`);
    }
  };
}

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900, device: undefined },
  { name: '375x812', width: 375, height: 812, device: devices['iPhone 13'] },
];

async function captureScreen(browser: Browser, state: ScreenState, viewport: typeof VIEWPORTS[number]) {
  const context = await browser.newContext({
    ...(viewport.device ?? {}),
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(MOCK_HTML).href);
  await page.waitForLoadState('networkidle');
  await state.navAction(page);
  await page.waitForTimeout(200);
  const outPath = path.join(BASELINES_DIR, viewport.name, `${state.id}.png`);
  await page.screenshot({ path: outPath, fullPage: true, animations: 'disabled' });
  console.log(`[capture] ${viewport.name}/${state.id}.png`);
  await context.close();
}

async function main() {
  const browser = await chromium.launch();
  try {
    for (const viewport of VIEWPORTS) {
      for (const state of SCREEN_STATES) {
        await captureScreen(browser, state, viewport);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[capture] failed:', err);
  process.exit(1);
});
