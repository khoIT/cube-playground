#!/usr/bin/env node
/**
 * Segment → Trino contract verifier (for downstream consumers).
 *
 * Demonstrates EXACTLY what a downstream team gets from the cube-playground app
 * to query Trino directly for ANY segment, and proves the three numbers agree:
 *
 *   [A] API-reported size   GET /api/segments/:id            -> total_count
 *   [B] live predicate      GET /api/segments/:id/membership-sql -> { sql, identity,
 *                           catalog, schema }, run on Trino as COUNT(*)
 *   [C] daily snapshot      stag_iceberg."<schema>".segment_membership_daily
 *                           (the nightly job's full materialization)
 *
 * If A ≈ B ≈ C, the downstream team can rely on reading [C] every day (cheapest,
 * zero API/Cube load) and fall back to [B] for ad-hoc/just-refreshed cohorts.
 *
 * This is read-only: it COUNTs and samples; it does not export the full cohort
 * (use pull-segment-snapshot.mjs for that).
 *
 * Env:
 *   SEGMENT_ID        segment uuid (required)
 *   API_BASE          playground API base (default http://localhost:3000)
 *   TRINO_HOST        e.g. http://trino-host:8080 (required)
 *   TRINO_USER        Trino user (default 'segment-verify')
 *   LAKEHOUSE_SCHEMA  Iceberg schema holding the snapshot tables
 *                       prod: 'khoitn/prod'   local: 'khoitn/local' (default)
 *   LAKEHOUSE_CATALOG snapshot catalog (default 'stag_iceberg')
 *   APP_JWT           bearer app-JWT for the guarded API calls (GET /:id,
 *                       /membership-sql). Mint via scripts/mint-service-jwt.mjs.
 *                       Not needed for the tokenless /members probe.
 *   CUBE_WORKSPACE    workspace the segment lives in (default 'prod') — must
 *                       match the segment's workspace or guarded calls 404.
 *
 * Run:
 *   SEGMENT_ID=942116cf-c64e-409f-9cec-d83030d33e15 \
 *   API_BASE=https://playground.gds.vng.vn \
 *   APP_JWT="$(JWT_SECRET=... EMAIL=svc-segment@vng.com.vn node scripts/mint-service-jwt.mjs)" \
 *   CUBE_WORKSPACE=prod \
 *   TRINO_HOST=http://<trino>:8080 LAKEHOUSE_SCHEMA=khoitn/prod \
 *     node scripts/verify-segment-trino-contract.mjs
 */

const SEGMENT_ID = process.env.SEGMENT_ID;
const API_BASE = (process.env.API_BASE ?? 'http://localhost:3000').replace(/\/$/, '');
const TRINO_HOST = (process.env.TRINO_HOST ?? '').replace(/\/$/, '');
const TRINO_USER = process.env.TRINO_USER ?? 'segment-verify';
const LAKEHOUSE_SCHEMA = process.env.LAKEHOUSE_SCHEMA ?? 'khoitn/local';
const LAKEHOUSE_CATALOG = process.env.LAKEHOUSE_CATALOG ?? 'stag_iceberg';
const APP_JWT = process.env.APP_JWT ?? '';
const CUBE_WORKSPACE = process.env.CUBE_WORKSPACE ?? 'prod';

if (!SEGMENT_ID) { console.error('SEGMENT_ID is required'); process.exit(1); }
if (!TRINO_HOST) { console.error('TRINO_HOST is required'); process.exit(1); }

const sqlLiteral = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sqlIdent = (s) => `"${String(s).replace(/"/g, '""')}"`; // quotes slash-bearing schema

// Trino REST: POST /v1/statement, follow nextUri to completion. Catalog/schema
// set the session so the membership SELECT's bare table names (mf_users, …)
// resolve — exactly what the app's connector does.
async function trino(sql, { catalog, schema } = {}) {
  const headers = { 'X-Trino-User': TRINO_USER, 'Content-Type': 'text/plain' };
  if (catalog) headers['X-Trino-Catalog'] = catalog;
  if (schema) headers['X-Trino-Schema'] = schema;
  let res = await fetch(`${TRINO_HOST}/v1/statement`, { method: 'POST', headers, body: sql });
  const rows = [];
  for (;;) {
    if (!res.ok) throw new Error(`Trino HTTP ${res.status}: ${await res.text()}`);
    const body = await res.json();
    if (body.error) throw new Error(`Trino: ${body.error.message}`);
    if (Array.isArray(body.data)) rows.push(...body.data);
    if (!body.nextUri) break;
    res = await fetch(body.nextUri, { headers: { 'X-Trino-User': TRINO_USER } });
  }
  return rows;
}

// Guarded endpoints need the bearer app-JWT + the segment's workspace header.
// The tokenless /members probe ignores both, so sending them is harmless there.
async function getJson(path) {
  const headers = { 'x-cube-workspace': CUBE_WORKSPACE };
  if (APP_JWT) headers.authorization = `Bearer ${APP_JWT}`;
  const r = await fetch(`${API_BASE}${path}`, { headers });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}: ${await r.text()}`);
  return r.json();
}

// ── [A] segment metadata the app exposes ───────────────────────────────────
console.log(`Segment ${SEGMENT_ID}\n`);
const seg = await getJson(`/api/segments/${SEGMENT_ID}`);
const apiCount = Number(seg.uid_count ?? seg.total_count ?? 0);
console.log('── [A] app metadata (GET /api/segments/:id) ───────────────────');
console.log(`  name          : ${seg.name}`);
console.log(`  game_id       : ${seg.game_id}`);
console.log(`  cube          : ${seg.cube}`);
console.log(`  type          : ${seg.type}`);
console.log(`  status        : ${seg.status}`);
console.log(`  last_refreshed: ${seg.last_refreshed_at}`);
console.log(`  uid_count     : ${apiCount}`);
console.log('');

// ── [B] the runnable Trino SELECT the app compiles for any predicate segment ─
let liveCount = null;
let membership = null;
try {
  membership = await getJson(`/api/segments/${SEGMENT_ID}/membership-sql`);
  console.log('── [B] live predicate (GET /api/segments/:id/membership-sql) ──');
  console.log(`  identity col  : ${membership.identity}`);
  console.log(`  catalog/schema: ${membership.catalog}.${membership.schema}`);
  console.log(`  SQL (first 400 chars):`);
  console.log('    ' + membership.sql.slice(0, 400).replace(/\n/g, '\n    '));
  console.log('  running COUNT(*) on Trino …');
  const rows = await trino(`SELECT count(*) FROM (${membership.sql}) t`, {
    catalog: membership.catalog,
    schema: membership.schema,
  });
  liveCount = Number(rows[0]?.[0] ?? 0);
  console.log(`  live cohort   : ${liveCount}`);
  console.log('');
} catch (err) {
  console.log(`  (membership-sql path unavailable: ${err.message})\n`);
}

// ── [C] the daily snapshot table (what the downstream reads every day) ──────
const T = `${LAKEHOUSE_CATALOG}.${sqlIdent(LAKEHOUSE_SCHEMA)}.segment_membership_daily`;
let snapCount = null;
let snapDate = null;
try {
  console.log('── [C] daily snapshot (segment_membership_daily) ──────────────');
  snapDate = (
    await trino(`SELECT max(snapshot_date) FROM ${T} WHERE segment_id = ${sqlLiteral(SEGMENT_ID)}`)
  )[0]?.[0];
  if (!snapDate) {
    console.log('  ⚠  no snapshot partition for this segment yet (job not run / segment new).');
  } else {
    const rows = await trino(
      `SELECT count(*) FROM ${T} ` +
        `WHERE snapshot_date = DATE ${sqlLiteral(snapDate)} AND segment_id = ${sqlLiteral(SEGMENT_ID)}`,
    );
    snapCount = Number(rows[0]?.[0] ?? 0);
    console.log(`  latest date   : ${snapDate}`);
    console.log(`  snapshot rows : ${snapCount}`);
    const sample = await trino(
      `SELECT uid FROM ${T} ` +
        `WHERE snapshot_date = DATE ${sqlLiteral(snapDate)} AND segment_id = ${sqlLiteral(SEGMENT_ID)} ` +
        `ORDER BY uid LIMIT 5`,
    );
    console.log(`  sample uids   : ${sample.map((r) => r[0]).join(', ')}`);
  }
  console.log('');
} catch (err) {
  console.log(`  (snapshot read failed: ${err.message})\n`);
}

// ── Verdict ─────────────────────────────────────────────────────────────────
const within = (a, b, tol = 0.02) =>
  a != null && b != null && b !== 0 && Math.abs(a - b) / b <= tol;
console.log('── verdict ────────────────────────────────────────────────────');
console.log(`  A app=${apiCount}  B live=${liveCount ?? 'n/a'}  C snapshot=${snapCount ?? 'n/a'}`);
if (within(liveCount, apiCount) && within(snapCount, apiCount)) {
  console.log('  ✅ A≈B≈C — daily reads of [C] are reliable; [B] is the ad-hoc fallback.');
} else if (within(snapCount, liveCount)) {
  console.log('  ✅ B≈C — live predicate and snapshot agree (app count may be a stale sample bound).');
} else {
  console.log('  ⚠  counts diverge >2% — likely the snapshot predates the last edit/refresh.');
  console.log('     Re-run after the nightly job, or compare snapshot_date vs last_refreshed_at.');
}
