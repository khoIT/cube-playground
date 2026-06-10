#!/usr/bin/env node
/**
 * Ad-hoc READ-ONLY Trino query runner for local investigation.
 *
 * Loads TRINO_PROFILER_* from the repo's own .env (same source the server
 * profiler uses) and issues one SQL statement over Trino's HTTP statement
 * protocol, paginating nextUri until exhausted. Credentials are read from .env
 * and never printed.
 *
 * Usage:
 *   node scripts/trino-query.mjs "SHOW TABLES FROM game_integration.cfm_vn"
 *   node scripts/trino-query.mjs --json "SELECT ..."
 *   echo "SELECT ..." | node scripts/trino-query.mjs
 *
 * Default catalog/schema: game_integration / (none). Fully-qualify tables as
 * game_integration.<schema>.<table> or pass --schema <name>.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadEnv() {
  const path = join(process.cwd(), '.env');
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const env = loadEnv();
const conn = {
  host: env.TRINO_PROFILER_HOST,
  port: Number(env.TRINO_PROFILER_PORT ?? 443),
  user: env.TRINO_PROFILER_USER ?? 'playground',
  password: env.TRINO_PROFILER_PASS ?? '',
  catalog: env.TRINO_PROFILER_CATALOG ?? 'game_integration',
  ssl: (env.TRINO_PROFILER_SSL ?? 'true') !== 'false',
};
if (!conn.host) {
  console.error('No TRINO_PROFILER_HOST in .env');
  process.exit(1);
}

const args = process.argv.slice(2);
let asJson = false;
let schema = '';
const sqlParts = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') asJson = true;
  else if (args[i] === '--schema') schema = args[++i];
  else sqlParts.push(args[i]);
}
let sql = sqlParts.join(' ').trim();
if (!sql) sql = readFileSync(0, 'utf8').trim();
if (!sql) { console.error('No SQL provided'); process.exit(1); }

const base = `${conn.ssl ? 'https' : 'http'}://${conn.host}:${conn.port}`;
const authHeader = conn.password
  ? { Authorization: `Basic ${Buffer.from(`${conn.user}:${conn.password}`).toString('base64')}` }
  : {};

async function trinoFetch(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'X-Trino-User': conn.user,
      'X-Trino-Catalog': conn.catalog,
      ...(schema ? { 'X-Trino-Schema': schema } : {}),
      Accept: 'application/json',
      ...authHeader,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText);
    throw new Error(`Trino ${res.status}: ${t}`);
  }
  return res.json();
}

let columns = [];
const rows = [];
let resp = await trinoFetch(`${base}/v1/statement`, {
  method: 'POST',
  body: sql,
  headers: { 'Content-Type': 'text/plain' },
});
for (;;) {
  if (resp.error) throw new Error(`Trino query error: ${resp.error.message ?? resp.error.errorName}`);
  if (resp.columns && columns.length === 0) columns = resp.columns.map((c) => c.name);
  if (resp.data) for (const r of resp.data) rows.push(r);
  if (!resp.nextUri) break;
  resp = await trinoFetch(resp.nextUri, { method: 'GET' });
}

if (asJson) {
  console.log(JSON.stringify({ columns, rows }, null, 2));
} else {
  console.log(columns.join('\t'));
  for (const r of rows) console.log(r.map((c) => (c === null ? '∅' : String(c))).join('\t'));
  console.error(`(${rows.length} rows)`);
}
