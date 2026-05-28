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

test('chat sessions are partitioned by workspace', async ({ request }) => {
  // The committed chat-snapshot seeds ~50 sessions under owner='dev'. All of
  // those rows pre-date the schema migration, so they backfill to workspace
  // 'local'. Asking the same owner+game with `X-Cube-Workspace: prod` MUST
  // return strictly fewer rows than `local` — that's the proof that the
  // partition filter is actually being applied at the DB level.
  const owner = 'dev';
  const game = 'ballistar';
  const baseUrl = 'http://localhost:3004/api/chat/sessions';
  const headersFor = (ws: string) => ({
    'X-Owner-Id': owner,
    'X-Cube-Workspace': ws,
    'Accept': 'application/json',
  });

  const localRes = await request.get(`${baseUrl}?game=${game}`, { headers: headersFor('local') });
  const prodRes = await request.get(`${baseUrl}?game=${game}`, { headers: headersFor('prod') });

  expect(localRes.status()).toBe(200);
  expect(prodRes.status()).toBe(200);

  const localList = (await localRes.json()) as Array<{ id: string; workspace?: string }>;
  const prodList = (await prodRes.json()) as Array<{ id: string; workspace?: string }>;

  console.log('=== CHAT PARTITION ===');
  console.log(`local sessions: ${localList.length}  prod sessions: ${prodList.length}`);

  // Seeded sessions live in local; prod should be empty (or at least strictly
  // smaller) on a fresh DB. The chip-on-the-shoulder assertion: if these are
  // equal AND non-zero, partitioning isn't filtering.
  expect(localList.length).toBeGreaterThan(0);
  expect(prodList.length).toBeLessThan(localList.length);
});
