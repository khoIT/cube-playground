/**
 * Live screenshot of the advisor's monitoring board, driving the real manual
 * builder flow (no OAuth needed) to the command screen for a real cfm_vn
 * segment, then freezing the groups so the board creates+assigns a real
 * experiment and renders the live monitor.
 *
 * Usage: node scripts/advisor-monitor-screenshot.mjs <segmentId>
 * Output: plans/260615-1432-advisor-experiment-flow/visuals/monitor-*.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const SEG = process.argv[2] ?? '0ad49643-bd99-43a0-b40f-4a0d4a809dd4';
const BASE = 'http://localhost:3000';
const OUT = 'plans/260615-1432-advisor-experiment-flow/visuals';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, texts, { timeout = 4000 } = {}) {
  for (const t of texts) {
    const btn = page.getByRole('button', { name: t, exact: false }).first();
    try {
      await btn.waitFor({ state: 'visible', timeout });
      await btn.click();
      return t;
    } catch {
      /* try next label */
    }
  }
  return null;
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 1100 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERR:', m.text().slice(0, 160)); });

  await page.goto(`${BASE}/#/advisor/${SEG}`, { waitUntil: 'networkidle' });
  await sleep(1500);
  await shot(page, 'monitor-01-goal');

  // GoalScreen: intro → echo → dig → board
  await clickByText(page, ['Build the experiment', 'Build the']);
  await sleep(800);
  await clickByText(page, ['Looks right', 'dig in']);
  await sleep(2000); // setup() has a ~1s delay then lands on the board
  await shot(page, 'monitor-02-board');

  // Walk the 5 stages, investigating each then KEEPING the findings (triage=keep
  // fills the blueprint slot AND, on the lever stage, sets the lever so the Decide
  // screen's "set up experiment" CTA is enabled).
  for (let i = 0; i < 5; i++) {
    await clickByText(page, ['Investigate this step', 'Investigate', 'Look at']);
    await sleep(1800);
    // Click every "Keep" (✓) triage button currently visible on this stage.
    const keeps = page.locator('button[title^="Keep"]');
    const n = await keeps.count();
    for (let k = 0; k < n; k++) {
      try { await keeps.nth(k).click({ timeout: 1500 }); } catch { /* skip */ }
    }
    await sleep(400);
    await clickByText(page, ['→']); // Next stage / Decide →
    await sleep(900);
  }
  await shot(page, 'monitor-03-after-stages');

  // Reach Decide (stepper) then set up the experiment → command screen.
  await clickByText(page, ['Decide']);
  await sleep(1000);
  await clickByText(page, ['Review & set up experiment', 'set up experiment', 'Send']);
  await sleep(2000);
  await shot(page, 'monitor-04-command');

  // Freeze the groups → board creates+assigns a real experiment, fetches scorecard.
  const froze = await clickByText(page, ['Confirm & freeze the groups', 'freeze the groups']);
  console.log('freeze click:', froze);
  await sleep(6000); // assign + scorecard
  await shot(page, 'monitor-05-frozen');

  // Advance one step into delivery so the treatment-vs-hold-out bars render.
  await clickByText(page, ['Mark delivery started', 'delivery']);
  await sleep(8000);
  await shot(page, 'monitor-06-monitoring');

  await browser.close();
  console.log('screenshots written to', OUT);
};

run().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
