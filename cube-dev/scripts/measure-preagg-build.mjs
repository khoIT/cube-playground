// Pre-aggregation build-cost measurer (runs INSIDE a cube container for Trino creds).
//
// Reads /tmp/preagg_sql.json ({ "<cube>.<preagg>_batch": "<build SELECT with ? params>" })
// and, for each pre-agg × each month, runs `SELECT count(*) FROM (<build select>)`
// against Trino — measuring the runtime + output-row-count of the exact aggregation
// the refresh worker would run. Pure read: it does NOT write to CubeStore.
//
// Why this is the number that matters: build time is dominated by the Trino
// scan+group-by, not CubeStore ingest. Sealed past partitions never rebuild, so
// steady-state refresh cost ≈ one current-partition build × frequency. Use these
// timings to pick per-model refresh cadence.
//
// Env (already present in cube-api-dev / cube-refresh-worker-dev):
//   CUBEJS_DB_USER / CUBEJS_DB_PASS / CUBEJS_DB_HOST / CUBEJS_DB_PORT / CUBEJS_DB_PRESTO_CATALOG
//   PREAGG_SCHEMA   — Trino schema to resolve bare table names against (e.g. cfm_vn)
//   PREAGG_MONTHS   — JSON: { "May26": ["2026-05-01","2026-05-31"], ... }

import https from 'https';
import fs from 'fs';

const u = process.env.CUBEJS_DB_USER;
const p = process.env.CUBEJS_DB_PASS || '';
const host = process.env.CUBEJS_DB_HOST;
const port = process.env.CUBEJS_DB_PORT || 8080;
const cat = process.env.CUBEJS_DB_PRESTO_CATALOG || 'game_integration';
const schema = process.env.PREAGG_SCHEMA || 'cfm_vn';
const months = JSON.parse(process.env.PREAGG_MONTHS
  || '{"May26":["2026-05-01","2026-05-31"],"Jun26":["2026-06-01","2026-06-09"]}');
const auth = 'Basic ' + Buffer.from(u + ':' + p).toString('base64');

const headers = (extra) => ({
  'X-Trino-User': u, Authorization: auth,
  'X-Trino-Catalog': cat, 'X-Trino-Schema': schema, ...extra,
});

function request(opts, body) {
  return new Promise((res, rej) => {
    const r = https.request(opts, (x) => { let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => res(d)); });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}

// Trino REST: POST statement, then follow nextUri until the result set drains.
async function runTrino(sql) {
  let raw = await request({ host, port, path: '/v1/statement', method: 'POST',
    rejectUnauthorized: false, headers: headers({ 'Content-Type': 'text/plain' }) }, sql);
  let j = JSON.parse(raw); const rows = [];
  for (;;) {
    if (j.data) rows.push(...j.data);
    if (j.error) return { err: JSON.stringify(j.error).slice(0, 130) };
    if (!j.nextUri) break;
    const nu = new URL(j.nextUri);
    raw = await request({ host: nu.hostname, port: nu.port, path: nu.pathname + nu.search,
      method: 'GET', rejectUnauthorized: false, headers: headers({}) });
    j = JSON.parse(raw);
  }
  return { rows };
}

// Substitute the two WHERE `?` range params with month-bound ISO literals.
function subParams(sql, dStart, dEnd) {
  let i = 0;
  const iso = [`${dStart}T00:00:00.000Z`, `${dEnd}T23:59:59.999Z`];
  return sql.replace(/\?/g, () => "'" + iso[i++] + "'");
}

// Event cubes (etl_*) expose a raw DATE `log_date`; their harvested build SQL applies
// `AT TIME ZONE` to it, which Trino rejects ("must be a time or timestamp (actual date)").
// Wrap every bare `log_date` ref as a timestamp — matches what the working cubes emit.
// Only used as a fallback, so cubes whose log_date is already wrapped aren't double-wrapped.
function wrapLogDate(sql) {
  return sql.replace(/"([a-z_]+)"\.log_date(?!_)/g,
    "from_iso8601_timestamp(CAST(\"$1\".log_date AS VARCHAR) || 'T00:00:00Z')");
}

const defs = JSON.parse(fs.readFileSync('/tmp/preagg_sql.json', 'utf8'));
const ids = Object.keys(defs).sort();
console.log(`schema=${schema}  models=${ids.length}`);
console.log('model'.padEnd(48), '| month  out_rows   build_s');
async function measure(sql) {
  const t = Date.now();
  let r; try { r = await runTrino(`SELECT count(*) c FROM (${sql}) t`); } catch (e) { r = { err: e.message }; }
  return { r, secs: ((Date.now() - t) / 1000).toFixed(1) };
}

for (const id of ids) {
  for (const [m, [a, b]] of Object.entries(months)) {
    let { r, secs } = await measure(subParams(defs[id], a, b));
    // Fallback: raw DATE log_date rejected by AT TIME ZONE -> retry with it wrapped.
    if (r.err && /must be a time or timestamp/.test(r.err)) {
      ({ r, secs } = await measure(subParams(wrapLogDate(defs[id]), a, b)));
    }
    const cnt = r.err ? 'ERR ' + r.err : (r.rows[0] ? r.rows[0][0] : '?');
    console.log(id.padEnd(48), `| ${m}  ${String(cnt).padEnd(9)} ${secs}s`);
  }
}
