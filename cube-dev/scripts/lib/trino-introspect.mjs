#!/usr/bin/env node
/**
 * READ-ONLY Trino introspection helpers for the cube-model onboarding generator.
 *
 * Ports the HTTP statement-protocol client from the main repo's
 * scripts/trino-query.mjs (cube-dev is a separate submodule, so the client is
 * copied rather than imported across the repo boundary). Credentials come from
 * the cube-playground root .env (TRINO_PROFILER_*) — searched upward from this
 * file, overridable via CUBE_PLAYGROUND_ENV. Nothing here ever writes to Trino.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Find the .env that carries TRINO_PROFILER_* (cube-playground root). Search the
// explicit override first, then walk up from this lib through the submodule to
// the superproject root, then fall back to CWD.
function findEnvFile() {
  const candidates = [
    process.env.CUBE_PLAYGROUND_ENV,
    resolve(HERE, '../../../.env'), // lib -> scripts -> cube-dev -> cube-playground
    resolve(HERE, '../../.env'),
    join(process.cwd(), '.env'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p) && readFileSync(p, 'utf8').includes('TRINO_PROFILER_HOST')) return p;
  }
  return null;
}

function loadEnv() {
  const path = findEnvFile();
  if (!path) throw new Error('No .env with TRINO_PROFILER_HOST found (set CUBE_PLAYGROUND_ENV)');
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
if (!conn.host) throw new Error('No TRINO_PROFILER_HOST in .env');

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

/** Run one SQL statement, return { columns:[name], rows:[[...]] }. */
export async function query(sql) {
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
  return { columns, rows };
}

/**
 * Set of column NAMES for one table in a schema; empty set = table absent.
 * Compared by name, not name:type — type-string differences (varchar vs
 * varchar(50), decimal precision) are not missing columns and would otherwise
 * produce false portability warnings on tables that are actually compatible.
 */
export async function columnSignature(schema, table) {
  const { rows } = await query(
    `SELECT column_name FROM ${conn.catalog}.information_schema.columns ` +
      `WHERE table_schema = '${schema}' AND table_name = '${table}'`,
  );
  return new Set(rows.map(([name]) => name));
}

/** Names of the common-core tables actually present in a schema. */
export async function presentTables(schema, names) {
  const list = names.map((n) => `'${n}'`).join(',');
  const { rows } = await query(
    `SELECT table_name FROM ${conn.catalog}.information_schema.tables ` +
      `WHERE table_schema = '${schema}' AND table_name IN (${list})`,
  );
  return new Set(rows.map((r) => r[0]));
}

/** Single scalar from a one-row, one-column query. */
export async function scalar(sql) {
  const { rows } = await query(sql);
  return rows.length ? rows[0][0] : null;
}

export { conn };
