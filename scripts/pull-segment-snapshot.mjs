#!/usr/bin/env node
/**
 * Daily segment membership snapshot puller.
 *
 * Proves the reliable way to export ALL user_ids of a large (~800k) segment
 * without stressing the cube-playground API:
 *
 *   Part 1 (diagnostic): hits GET /api/segments/:id/members and shows that it
 *     caps at the stored snapshot (top ~1000 ranked / ≤5000 uid sample) and
 *     reports truncated:true — i.e. it is NOT a full-cohort export.
 *
 *   Part 2 (the real pull): keyset-paginates the FULL cohort straight from the
 *     Trino lakehouse table the nightly snapshot job already materialized:
 *       stag_iceberg."khoitn/local".segment_membership_daily
 *     Partition-pruned to one (snapshot_date, game_id, segment_id) slice,
 *     ordered by uid, streamed in pages of PAGE_SIZE. Zero load on the
 *     playground API and zero Cube/Trino fan-out beyond one pruned table scan.
 *
 *     Fallback: if the snapshot table isn't enabled (SEGMENT_SNAPSHOT_ENABLED),
 *     fetch GET /api/segments/:id/membership-sql and wrap it as a subquery for
 *     the same keyset pagination.
 *
 * Env:
 *   SEGMENT_ID        segment uuid (required)
 *   API_BASE          playground API base (default http://localhost:3000)
 *   TRINO_HOST        e.g. http://trino-host:8080 (required for the real pull)
 *   TRINO_USER        Trino user (default 'segment-export')
 *   TRINO_CATALOG     session catalog (default 'stag_iceberg')
 *   LAKEHOUSE_SCHEMA  Iceberg schema (default 'khoitn/local'; prod 'khoitn/prod')
 *   SNAPSHOT_DATE     YYYY-MM-DD (default: latest available for the segment)
 *   PAGE_SIZE         keyset page size (default 50000)
 *   OUT              output file (default ./segment-<id>-<date>.uids.gz)
 *   USE_MEMBERSHIP_SQL  '1' to force the membership-sql fallback path
 *   APP_JWT           bearer app-JWT for the guarded membership-sql fallback
 *                       (mint via scripts/mint-service-jwt.mjs). The /members
 *                       probe is tokenless and ignores it.
 *   CUBE_WORKSPACE    workspace the segment lives in (default 'prod') — only
 *                       used by the guarded membership-sql fallback.
 *
 * Run (lakehouse table path — no APP_JWT needed):
 *   SEGMENT_ID=942116cf-... TRINO_HOST=http://host:8080 \
 *   LAKEHOUSE_SCHEMA=khoitn/prod node scripts/pull-segment-snapshot.mjs
 *
 * Run (membership-sql fallback — needs APP_JWT + workspace):
 *   SEGMENT_ID=942116cf-... TRINO_HOST=http://host:8080 USE_MEMBERSHIP_SQL=1 \
 *   APP_JWT="$(JWT_SECRET=... EMAIL=svc-segment@vng.com.vn node scripts/mint-service-jwt.mjs)" \
 *   CUBE_WORKSPACE=prod node scripts/pull-segment-snapshot.mjs
 */

import { createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';

const SEGMENT_ID = process.env.SEGMENT_ID;
const API_BASE = (process.env.API_BASE ?? 'http://localhost:3000').replace(/\/$/, '');
const TRINO_HOST = (process.env.TRINO_HOST ?? '').replace(/\/$/, '');
const TRINO_USER = process.env.TRINO_USER ?? 'segment-export';
const TRINO_CATALOG = process.env.TRINO_CATALOG ?? 'stag_iceberg';
const LAKEHOUSE_SCHEMA = process.env.LAKEHOUSE_SCHEMA ?? 'khoitn/local';
const PAGE_SIZE = Number(process.env.PAGE_SIZE ?? 50000);
const USE_MEMBERSHIP_SQL = process.env.USE_MEMBERSHIP_SQL === '1';
const APP_JWT = process.env.APP_JWT ?? '';
const CUBE_WORKSPACE = process.env.CUBE_WORKSPACE ?? 'prod';

// API calls: tokenless /members ignores these; the guarded /membership-sql
// fallback needs the bearer app-JWT + the segment's workspace header.
function apiHeaders() {
  const h = { 'x-cube-workspace': CUBE_WORKSPACE };
  if (APP_JWT) h.authorization = `Bearer ${APP_JWT}`;
  return h;
}

if (!SEGMENT_ID) {
  console.error('SEGMENT_ID is required');
  process.exit(1);
}

const sqlLiteral = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── Trino REST: POST /v1/statement, follow nextUri until done ──────────────
// One logical query streams across many HTTP pages already; we additionally
// keyset-paginate at the SQL level so each query is bounded and resumable.
async function trino(sql) {
  if (!TRINO_HOST) throw new Error('TRINO_HOST not set — cannot run the real pull');
  let res = await fetch(`${TRINO_HOST}/v1/statement`, {
    method: 'POST',
    headers: {
      'X-Trino-User': TRINO_USER,
      'X-Trino-Catalog': TRINO_CATALOG,
      'Content-Type': 'text/plain',
    },
    body: sql,
  });
  const rows = [];
  let columns = null;
  for (;;) {
    if (!res.ok) throw new Error(`Trino HTTP ${res.status}: ${await res.text()}`);
    const body = await res.json();
    if (body.error) throw new Error(`Trino: ${body.error.message}`);
    if (body.columns && !columns) columns = body.columns.map((c) => c.name);
    if (Array.isArray(body.data)) rows.push(...body.data);
    if (!body.nextUri) break;
    res = await fetch(body.nextUri, { headers: { 'X-Trino-User': TRINO_USER } });
  }
  return { columns, rows };
}

// ── Part 1: prove the members API is a capped sampler, not a full export ───
async function probeMembersApi() {
  const url = `${API_BASE}/api/segments/${SEGMENT_ID}/members?limit=1000`;
  try {
    const r = await fetch(url, { headers: apiHeaders() });
    const j = await r.json();
    console.log('── members API probe ──────────────────────────────────────');
    console.log(`  total_count   : ${j.total_count}`);
    console.log(`  returned_count: ${j.returned_count}`);
    console.log(`  truncated     : ${j.truncated}`);
    console.log(`  next_cursor   : ${j.next_cursor}`);
    if (j.truncated) {
      console.log(
        `  ⚠  served a SAMPLE of ${j.returned_count}/${j.total_count}. ` +
          `Paginating this endpoint will never yield the full cohort.`,
      );
    }
    console.log('');
  } catch (err) {
    console.log(`  (members probe skipped: ${err.message})\n`);
  }
}

// ── Resolve the SELECT that yields all uids ────────────────────────────────
// Default: read the pre-materialized daily snapshot table (cheapest).
// Fallback: the live membership SELECT compiled by the API.
async function resolveSource() {
  if (!USE_MEMBERSHIP_SQL) {
    const date =
      process.env.SNAPSHOT_DATE ??
      (
        await trino(
          `SELECT max(snapshot_date) FROM ${TRINO_CATALOG}.${sqlIdent(LAKEHOUSE_SCHEMA)}.segment_membership_daily ` +
            `WHERE segment_id = ${sqlLiteral(SEGMENT_ID)}`,
        )
      ).rows[0]?.[0];
    if (date) {
      const table = `${TRINO_CATALOG}.${sqlIdent(LAKEHOUSE_SCHEMA)}.segment_membership_daily`;
      return {
        date,
        // partition-pruned to one (snapshot_date, segment_id) slice
        inner: `SELECT uid FROM ${table} WHERE snapshot_date = DATE ${sqlLiteral(date)} AND segment_id = ${sqlLiteral(SEGMENT_ID)}`,
        idCol: 'uid',
      };
    }
    console.log('  (no snapshot partition found — falling back to membership-sql)\n');
  }
  // Fallback: ask the API for the runnable Trino SELECT and wrap it.
  const r = await fetch(`${API_BASE}/api/segments/${SEGMENT_ID}/membership-sql`, {
    headers: apiHeaders(),
  });
  if (!r.ok) throw new Error(`membership-sql ${r.status}: ${await r.text()}`);
  const { sql, identity } = await r.json();
  return { date: 'live', inner: sql, idCol: identity };
}

// quote a possibly slash-bearing Iceberg schema: khoitn/local -> "khoitn/local"
const sqlIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;

// ── Part 2: keyset-paginate the full cohort, gzip to disk ──────────────────
async function pullAll() {
  const { date, inner, idCol } = await resolveSource();
  const out = process.env.OUT ?? `./segment-${SEGMENT_ID}-${date}.uids.gz`;
  const gz = createGzip();
  const file = createWriteStream(out);
  gz.pipe(file);

  console.log('── full cohort pull (Trino keyset) ────────────────────────');
  console.log(`  source date : ${date}`);
  console.log(`  output      : ${out}`);

  let last = '';
  let total = 0;
  const t0 = Date.now();
  for (;;) {
    // Keyset on uid (not OFFSET) so deep pages stay cheap and the run is
    // resumable from `last` after any interruption.
    const page = await trino(
      `SELECT ${idCol} AS uid FROM (${inner}) t ` +
        `WHERE ${idCol} > ${sqlLiteral(last)} ORDER BY ${idCol} ASC LIMIT ${PAGE_SIZE}`,
    );
    if (page.rows.length === 0) break;
    for (const [uid] of page.rows) gz.write(uid + '\n');
    total += page.rows.length;
    last = page.rows[page.rows.length - 1][0];
    process.stdout.write(`\r  pulled: ${total}`);
    if (page.rows.length < PAGE_SIZE) break; // last page
  }
  await new Promise((res) => gz.end(res));
  console.log(`\n  done: ${total} uids in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}\n`);
}

await probeMembersApi();
await pullAll();
