#!/usr/bin/env node
/**
 * Cube Cloud session manager + headless driver.
 *
 * Cube Cloud's web app authenticates with an Express session cookie
 * (`connect.sid`), not a bearer token. Rather than paste a short-lived cookie
 * by hand, this script logs in once in a *headed* browser (you complete the
 * SSO/email flow yourself), persists the resulting cookies + localStorage to a
 * Playwright storageState file, then reuses that state for fast *headless*
 * runs. When the session goes stale you just re-run `login`.
 *
 * The storageState file is a live credential — it is gitignored, never printed.
 *
 * Usage:
 *   node scripts/cubecloud-session.mjs login          # headed, one-time
 *   node scripts/cubecloud-session.mjs check          # headless auth probe
 *   node scripts/cubecloud-session.mjs shot <urlPath> <out.png>
 *   node scripts/cubecloud-session.mjs graphql '<query>'   # POST to /graphql/
 *
 * Env:
 *   CUBECLOUD_BASE   default https://khoi-analytics.cubecloud.dev
 *   CUBECLOUD_STATE  default ./.cubecloud-auth.json
 */
import { chromium } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.env.CUBECLOUD_BASE ?? 'https://khoi-analytics.cubecloud.dev').replace(/\/$/, '');
const STATE = process.env.CUBECLOUD_STATE ?? join(process.cwd(), '.cubecloud-auth.json');
const cmd = process.argv[2] ?? 'check';

/** True once the app shell is reachable without bouncing to a login screen. */
async function isAuthed(page) {
  const url = page.url();
  if (/\/(auth|login|sign[_-]?in|u\/login)/i.test(url) || url.includes('accounts.google.com')) return false;
  // The session cookie is the source of truth for an authenticated session.
  const cookies = await page.context().cookies();
  return cookies.some((c) => c.name === 'connect.sid' && c.value);
}

async function withContext(fn, { headless = true } = {}) {
  const browser = await chromium.launch({ headless });
  const ctx = await browser.newContext(
    existsSync(STATE) ? { storageState: STATE } : undefined
  );
  try {
    return await fn(ctx, browser);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

async function login() {
  console.error(`Opening ${BASE} in a visible browser. Complete the login, then come back here.`);
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // Poll until the session cookie appears and we're off any auth screen.
  const deadlineMs = Date.now() + 5 * 60_000;
  let ok = false;
  while (Date.now() < deadlineMs) {
    if (await isAuthed(page)) { ok = true; break; }
    await page.waitForTimeout(1000);
  }
  if (!ok) {
    await ctx.close();
    await browser.close();
    console.error('Timed out waiting for login (5 min). Re-run `login` and finish sign-in.');
    process.exit(1);
  }
  // Give the app a beat to settle any post-login token writes, then snapshot.
  await page.waitForTimeout(1500);
  await ctx.storageState({ path: STATE });
  await ctx.close();
  await browser.close();
  console.error(`Session saved → ${STATE}`);
}

async function check() {
  if (!existsSync(STATE)) {
    console.error(`No session file at ${STATE}. Run: node scripts/cubecloud-session.mjs login`);
    process.exit(2);
  }
  await withContext(async (ctx) => {
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const authed = await isAuthed(page);
    console.error(authed ? `OK — session valid (${BASE})` : 'STALE — re-run `login`');
    if (!authed) process.exit(3);
  });
}

async function shot() {
  const urlPath = process.argv[3] ?? '/';
  const out = process.argv[4] ?? 'cubecloud.png';
  await withContext(async (ctx) => {
    const page = await ctx.newPage();
    const target = urlPath.startsWith('http') ? urlPath : `${BASE}${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;
    await page.goto(target, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: out, fullPage: true });
    console.error(`Saved screenshot → ${out} (${target})`);
  });
}

/** Replay the session cookie against the GraphQL endpoint the web app uses. */
async function graphql() {
  const query = process.argv[3];
  if (!query) { console.error('Provide a GraphQL query string'); process.exit(1); }
  if (!existsSync(STATE)) { console.error('No session — run `login` first'); process.exit(2); }
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  const cookieHeader = (state.cookies ?? [])
    .filter((c) => BASE.includes(c.domain.replace(/^\./, '')))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const res = await fetch(`${BASE}/graphql/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  console.log(text);
  if (!res.ok) process.exit(4);
}

const handlers = { login, check, shot, graphql };
const handler = handlers[cmd];
if (!handler) {
  console.error(`Unknown command "${cmd}". Use: login | check | shot | graphql`);
  process.exit(1);
}
await handler();
