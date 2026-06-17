#!/usr/bin/env node
/**
 * Cube Cloud product discovery driver.
 *
 * Drives the authenticated web app (reusing the storageState minted by
 * cubecloud-session.mjs), and for each surface it visits it:
 *   - records every GraphQL operation the app fires (operationName + the data
 *     API / deployment paths it proxies to), since introspection is disabled
 *     and this is the only way to learn the real control-plane API,
 *   - harvests in-app nav links to discover further routes,
 *   - screenshots the rendered page for visual understanding.
 *
 * Output: an <outdir> with one PNG per route + a captured-operations JSON.
 *
 * Usage:
 *   node scripts/cubecloud-discover.mjs <outdir> [route1 route2 ...]
 * If no routes are given it seeds from /d/1/model and follows discovered links.
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.env.CUBECLOUD_BASE ?? 'https://khoi-analytics.cubecloud.dev').replace(/\/$/, '');
const STATE = process.env.CUBECLOUD_STATE ?? join(process.cwd(), '.cubecloud-auth.json');
const outdir = process.argv[2] ?? join(process.cwd(), 'cubecloud-discovery');
const seedRoutes = process.argv.slice(3);

if (!existsSync(STATE)) { console.error('No session — run cubecloud-session.mjs login'); process.exit(2); }
mkdirSync(outdir, { recursive: true });

const ops = [];           // captured GraphQL operations
const apiCalls = [];      // captured non-graphql data API / proxy calls
const discovered = new Set();

function slug(route) {
  return route.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
}

async function visit(page, route) {
  const target = route.startsWith('http') ? route : `${BASE}${route.startsWith('/') ? '' : '/'}${route}`;
  console.error(`→ ${route}`);
  await page.goto(target, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(outdir, `${slug(route)}.png`), fullPage: true }).catch(() => {});

  // Harvest in-app links for further discovery.
  const links = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')))
    .catch(() => []);
  for (const href of links) {
    if (href && /^\/(d\/|deployments|settings|members|teams|integrations)/.test(href)) discovered.add(href.split('?')[0]);
  }
  // Capture a short text digest of the page so the report has context.
  const heading = await page.locator('h1,h2').allInnerTexts().catch(() => []);
  return { route, target, url: page.url(), headings: heading.slice(0, 8) };
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

page.on('request', (req) => {
  const u = req.url();
  if (u.endsWith('/graphql/') || u.includes('/graphql')) {
    try {
      const body = JSON.parse(req.postData() ?? '{}');
      ops.push({ operationName: body.operationName ?? null, query: (body.query ?? '').replace(/\s+/g, ' ').slice(0, 240), vars: body.variables ?? null });
    } catch { /* non-json */ }
  } else if (/\/cubejs|\/cubesql|\/deployments\/.*\/(api|load|meta|sql)|\/livez|\/readyz/.test(u)) {
    apiCalls.push(`${req.method()} ${u.replace(BASE, '')}`);
  }
});

const pages = [];
const queue = seedRoutes.length ? [...seedRoutes] : ['/d/1/model'];
const seen = new Set();
while (queue.length) {
  const route = queue.shift();
  if (seen.has(route)) continue;
  seen.add(route);
  pages.push(await visit(page, route));
  // On the first (seed) pass, enqueue discovered routes once.
  if (!seedRoutes.length && seen.size === 1) {
    for (const r of discovered) if (!seen.has(r)) queue.push(r);
  }
}

// Dedup ops by operationName, keep one example each.
const byName = new Map();
for (const o of ops) {
  const k = o.operationName ?? o.query.slice(0, 40);
  if (!byName.has(k)) byName.set(k, o);
}

const summary = {
  base: BASE,
  visited: pages,
  graphqlOperations: [...byName.values()].sort((a, b) => String(a.operationName).localeCompare(String(b.operationName))),
  dataApiCalls: [...new Set(apiCalls)],
};
writeFileSync(join(outdir, 'captured-operations.json'), JSON.stringify(summary, null, 2));
console.error(`\nVisited ${pages.length} routes; ${byName.size} distinct GraphQL ops; ${summary.dataApiCalls.length} data-API calls.`);
console.error(`Output → ${outdir}`);

await ctx.close();
await browser.close();
