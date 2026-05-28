import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('catalog renders prod+ballistar end-to-end', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('gds-cube:workspace', 'prod');
    localStorage.setItem('gds-cube:active-game', 'ballistar');
  });

  const reqs: string[] = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (u.includes('/cube-api/') || u.includes('/cubejs-api/') || u.includes('/api/business-metrics') || u.includes('/api/playground/') || u.includes('/playground/context')) {
      const ws = resp.request().headers()['x-cube-workspace'] ?? '-';
      reqs.push(`[${resp.status()}] ws=${ws} ${u.replace('http://localhost:3000', '')}`);
    }
  });

  // ---------------- METRICS TAB ----------------
  await page.goto('http://localhost:3000/#/catalog/metrics', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Poll for the count chip to show non-zero availability.
  let chipFinal: string | null = null;
  for (let i = 0; i < 60; i++) {
    chipFinal = await page.locator('text=/\\d+ of \\d+ available/').first().textContent().catch(() => null);
    if (chipFinal && !/^0 shown · 0 of /.test(chipFinal)) break;
    await page.waitForTimeout(500);
  }

  console.log('=== METRICS TAB ===');
  console.log('chip final:', chipFinal);

  // Sanity: chip should report >0 available metrics
  expect(chipFinal ?? '').toMatch(/[1-9]\d* of \d+ available for Ballistar/);

  // ---------------- DATA MODEL TAB ----------------
  await page.evaluate(() => { window.location.hash = '#/catalog/data-model'; });
  await page.waitForTimeout(4_000);

  const bodyText = (await page.locator('main').innerText().catch(() => '')) || '';
  const ballistarMentions = (bodyText.match(/ballistar_/gi) ?? []).length;

  console.log('=== DATA MODEL TAB ===');
  console.log('ballistar_ mentions in main:', ballistarMentions);
  console.log('body sample (first 400 chars):', bodyText.slice(0, 400).replace(/\s+/g, ' '));

  console.log('--- requests ---');
  for (const r of reqs) console.log(r);
});
