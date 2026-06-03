#!/usr/bin/env node
/**
 * Sync the shared secrets from the local dev env files into .env.docker.local.
 *
 * The dockerized stack (`npm run stack`, and the dev:all dev-cube) reads its
 * secrets from .env.docker.local, but several of them MUST match what the
 * host-side dev processes use — most importantly CUBEJS_API_SECRET (the gateway
 * mints the Cube JWT, cube_api verifies it). Rather than maintain two copies by
 * hand, this copies the values from your dev sources into .env.docker.local.
 *
 * Run it after editing your dev env, or whenever a secret rotates:
 *   npm run stack:env-sync
 *
 * Secret-safe: values are read and written but never printed — only the key
 * NAMES that were synced are logged. Existing .env.docker.local values for keys
 * not found (non-empty) in any dev source are left untouched.
 *
 * Dev sources, in precedence order (first non-empty wins):
 *   .env.local  >  .env  >  chat-service/.env  >  cube-dev/.env
 *
 * cube-dev/.env is last because it is the canonical home for the Cube backend's
 * Trino connection (CUBEJS_DB_HOST/USER/PASS) — the playground's own dev env
 * never carries those (only the Cube talks to Trino). It is LAST so a shared app
 * secret present in both (e.g. CUBEJS_API_SECRET) is taken from the playground
 * side, which the host gateway mints with; cube-dev only fills the DB-cred gap.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = resolve(repoRoot, '.env.docker.local');
const EXAMPLE = resolve(repoRoot, '.env.docker.local.example');
// First match wins.
const SOURCES = ['.env.local', '.env', 'chat-service/.env', 'cube-dev/.env'].map((f) => resolve(repoRoot, f));

// Keys whose values are shared between the host dev processes and the container
// stack. Only these are copied; everything else in .env.docker.local is left as-is.
const SHARED_KEYS = [
  'CUBEJS_API_SECRET',          // gateway mints / cube_api verifies — MUST match
  'CUBE_PLAYGROUND_USER_ID',
  'CUBE_AUTH_INTERNAL_SECRET',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'LITELLM_BASE_URL',
  'LITELLM_API_KEY_STG',
  'LITELLM_MODEL',
  'MAIN_SERVER_SERVICE_TOKEN',
  'CONNECTOR_SECRET_KEY',
  'CUBEJS_DB_HOST', 'CUBEJS_DB_PORT', 'CUBEJS_DB_USER', 'CUBEJS_DB_PASS',
  'CUBEJS_DB_PRESTO_CATALOG', 'CUBEJS_DB_CATALOG', 'CUBEJS_DB_SSL',
  'TRINO_PROFILER_HOST', 'TRINO_PROFILER_PORT', 'TRINO_PROFILER_USER',
  'TRINO_PROFILER_PASS', 'TRINO_PROFILER_CATALOG', 'TRINO_PROFILER_SSL',
  'TRINO_PROFILER_WORKSPACE',
];

// Minimal .env parser: KEY=VALUE per line, ignore blanks/comments, strip one
// layer of surrounding quotes, keep the first occurrence.
function parseEnv(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key in out) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// Resolve each shared key from the dev sources (first source with a non-empty value).
const resolved = {};
for (const src of SOURCES) {
  if (!existsSync(src)) continue;
  const env = parseEnv(readFileSync(src, 'utf8'));
  for (const key of SHARED_KEYS) {
    if (!(key in resolved) && env[key] !== undefined && env[key] !== '') {
      resolved[key] = env[key];
    }
  }
}

const found = Object.keys(resolved);
if (found.length === 0) {
  console.error('[env-sync] no shared keys found in dev env files — nothing to sync.');
  console.error(`[env-sync] looked in: ${SOURCES.join(', ')}`);
  process.exit(1);
}

// Ensure the target exists (seed from the example), then upsert each resolved key.
if (!existsSync(TARGET)) {
  if (!existsSync(EXAMPLE)) {
    console.error(`[env-sync] ${TARGET} and its .example are both missing.`);
    process.exit(1);
  }
  copyFileSync(EXAMPLE, TARGET);
  console.log('[env-sync] created .env.docker.local from the example.');
}

const lines = readFileSync(TARGET, 'utf8').split('\n');
const remaining = new Set(found);
const updated = lines.map((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return line;
  const eq = t.indexOf('=');
  if (eq <= 0) return line;
  const key = t.slice(0, eq).trim();
  if (remaining.has(key)) {
    remaining.delete(key);
    return `${key}=${resolved[key]}`;
  }
  return line;
});
// Append any shared keys that weren't already present in the target.
for (const key of remaining) updated.push(`${key}=${resolved[key]}`);

writeFileSync(TARGET, updated.join('\n'));
console.log(`[env-sync] synced ${found.length} key(s) into .env.docker.local: ${found.join(', ')}`);
console.log('[env-sync] values not printed. Re-run after rotating any dev secret.');
