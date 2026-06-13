#!/usr/bin/env node
/**
 * Onboard a game's canonical Cube model from sampled Trino data.
 *
 * Clean cubes (source tables present, no shape-altering anomaly) are emitted by
 * copying the cfm canonical template and relabeling the title. Data-shape
 * anomalies are detected by sampling and FLAGGED with a proposed strategy — the
 * script never auto-applies an anomaly override; an agent reviews flags and
 * decides. Non-destructive by default (only writes missing cubes; --force to
 * overwrite). See reports/canonical-cube-catalog.md for the frozen 16-cube spec.
 *
 * Usage:
 *   node scripts/onboard-game-cube-model.mjs <game> [--dry-run] [--force] [--only a,b]
 *   node scripts/onboard-game-cube-model.mjs ballistar --dry-run
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GAME_SCHEMA, GAME_LABEL, TEMPLATE_GAME, TEMPLATE_LABEL, CANONICAL_CUBES,
  ANOMALY_SENSITIVE, DUAL_IDENTITY_AT_RATIO, HIGH_SCALE_ROWS,
} from './lib/canonical-cube-config.mjs';
import { presentTables, columnSignature, scalar, conn } from './lib/trino-introspect.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CUBES_ROOT = resolve(HERE, '../cube/model/cubes');
const REPORTS_DIR = resolve(HERE, 'reports');

function parseArgs(argv) {
  const o = { dryRun: false, force: false, only: null, game: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--force') o.force = true;
    else if (a === '--only') {
      const v = argv[++i];
      if (!v) { console.error('--only requires a comma-separated cube list'); process.exit(1); }
      o.only = v.split(',').map((s) => s.trim());
    }
    else if (a === '--help' || a === '-h') o.help = true;
    else if (!a.startsWith('-')) o.game = a;
  }
  return o;
}

function usage() {
  console.log('Usage: node scripts/onboard-game-cube-model.mjs <game> [--dry-run] [--force] [--only a,b]');
  console.log('  games:', Object.keys(GAME_SCHEMA).join(', '));
}

// Relabel a cfm template body for the target game (the only game-specific token).
function relabel(body, label) {
  return body.split(TEMPLATE_LABEL).join(label);
}

// Sample data shape; return anomaly flags (script flags, agent decides).
// A sampler ERROR on an mf_users-shaping probe is treated as UNSAFE — it flags
// mf_users so a transient Trino failure can never silently downgrade an
// anomalous game (jus/tf) into a clean cfm-template emit.
async function detectAnomalies(schema) {
  const flags = [];
  // dual-identity: user_id carrying an '@' suffix (jus merged-account shape).
  try {
    const idStats = await scalar(
      `SELECT CAST(count_if(user_id LIKE '%@%') AS DOUBLE) / NULLIF(count(*), 0) ` +
        `FROM ${conn.catalog}.${schema}.mf_users`,
    );
    if (idStats != null && Number(idStats) > DUAL_IDENTITY_AT_RATIO) {
      flags.push({
        cube: 'mf_users', kind: 'dual-identity', detail: `${(Number(idStats) * 100).toFixed(1)}% user_id with '@' suffix`,
        strategy: "wrap source in split_part(user_id,'@',1) merge CTE (jus-style); do NOT clean-emit — preserve/author hand-tuned mf_users",
      });
    }
  } catch (e) {
    flags.push({ cube: 'mf_users', kind: 'sampling-error', detail: `dual-identity probe failed: ${e.message}`,
      strategy: 'could not verify identity shape — mf_users skipped (not emitted) until the probe succeeds' });
  }
  // role-name-absent: ingame_last_active_role_name 100% NULL (tf shape).
  try {
    const named = await scalar(
      `SELECT count_if(ingame_last_active_role_name IS NOT NULL) FROM ${conn.catalog}.${schema}.mf_ingame_roles`,
    );
    if (named != null && Number(named) === 0) {
      flags.push({
        cube: 'mf_users', kind: 'role-name-absent', detail: 'ingame_last_active_role_name 100% NULL',
        strategy: 'emit plain sql_table: mf_users and DROP the ingame_name dimension (tf-style)',
      });
    }
  } catch (e) {
    flags.push({ cube: 'mf_users', kind: 'sampling-error', detail: `role-name probe failed: ${e.message}`,
      strategy: 'could not verify role-name shape — mf_users skipped (not emitted) until the probe succeeds' });
  }
  // high-scale: source row count above which pre-aggs are mandatory day one (ptg).
  // Non-blocking (operational warning only) so a probe failure does not skip cubes.
  const rows = await scalar(`SELECT count(*) FROM ${conn.catalog}.${schema}.std_ingame_user_active_daily`).catch(() => null);
  if (rows != null && Number(rows) > HIGH_SCALE_ROWS) {
    flags.push({
      cube: '(serving)', kind: 'high-scale', detail: `${Number(rows).toLocaleString()} rows in std_ingame_user_active_daily`,
      strategy: 'cfm template carries rollups; after deploy restart cube_api + worker and probe usedPreAggregations',
    });
  }
  return flags;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.game) { usage(); process.exit(opts.help ? 0 : 1); }
  const game = opts.game;
  const schema = GAME_SCHEMA[game];
  const label = GAME_LABEL[game];
  if (!schema) { console.error(`Unknown game: ${game}`); usage(); process.exit(1); }
  if (game === TEMPLATE_GAME && !opts.force) {
    console.error(`${game} is the template source; refusing to self-onboard without --force.`);
    process.exit(1);
  }

  const wanted = opts.only ?? Object.keys(CANONICAL_CUBES);
  const allTables = [...new Set(Object.values(CANONICAL_CUBES).flat())];
  const present = await presentTables(schema, allTables);
  const anomalies = await detectAnomalies(schema);
  const anomalyCubes = new Set(anomalies.filter((f) => f.cube !== '(serving)').map((f) => f.cube));

  const emitted = [], skippedExist = [], skippedMissing = [], flaggedSkip = [], sigDrift = [], cfmLeak = [];

  for (const cube of wanted) {
    const sources = CANONICAL_CUBES[cube];
    if (!sources) { console.error(`! not a canonical cube: ${cube}`); continue; }
    const missing = sources.filter((t) => !present.has(t));
    if (missing.length) { skippedMissing.push({ cube, missing }); continue; }

    // Shape-altering anomaly on a sensitive cube -> flag, never auto-emit.
    if (ANOMALY_SENSITIVE.has(cube) && anomalyCubes.has(cube)) { flaggedSkip.push(cube); continue; }

    // Column-signature drift vs cfm (warn only; body is still portable).
    for (const t of sources) {
      const [cfmSig, gameSig] = await Promise.all([
        columnSignature(GAME_SCHEMA[TEMPLATE_GAME], t), columnSignature(schema, t),
      ]);
      const onlyCfm = [...cfmSig].filter((c) => !gameSig.has(c));
      if (onlyCfm.length) sigDrift.push({ cube, table: t, missingCols: onlyCfm.length });
    }

    const tmplPath = join(CUBES_ROOT, TEMPLATE_GAME, `${cube}.yml`);
    const outPath = join(CUBES_ROOT, game, `${cube}.yml`);
    if (!existsSync(tmplPath)) { console.error(`! template missing: ${tmplPath}`); continue; }
    if (existsSync(outPath) && !opts.force) { skippedExist.push(cube); continue; }

    const body = relabel(readFileSync(tmplPath, 'utf8'), label);
    // Insurance against future template drift: a standalone "CFM" surviving the
    // relabel means a template author left a bare brand token outside "CFM VN".
    if (/\bCFM\b/.test(body)) cfmLeak.push(cube);
    if (!opts.dryRun) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, body);
    }
    emitted.push(cube);
  }

  writeManifest({ game, schema, opts, emitted, skippedExist, skippedMissing, flaggedSkip, sigDrift, cfmLeak, anomalies });
}

function writeManifest(r) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `# Onboarding manifest — ${r.game} (${r.schema}) — ${date}`,
    r.opts.dryRun ? '\n> DRY RUN — no files written.\n' : '',
    `\n## Emitted (${r.emitted.length})\n` + (r.emitted.map((c) => `- ${c}`).join('\n') || '- none'),
    `\n## Skipped — already present (${r.skippedExist.length})\n` + (r.skippedExist.map((c) => `- ${c}`).join('\n') || '- none'),
    `\n## Skipped — source table missing (${r.skippedMissing.length})\n` +
      (r.skippedMissing.map((s) => `- ${s.cube} (missing: ${s.missing.join(', ')})`).join('\n') || '- none'),
    `\n## FLAGGED for agent decision — anomaly, not emitted (${r.flaggedSkip.length})\n` +
      (r.flaggedSkip.map((c) => `- ${c}`).join('\n') || '- none'),
    `\n## Anomaly signals (${r.anomalies.length})\n` +
      (r.anomalies.map((a) => `- **${a.kind}** [${a.cube}]: ${a.detail}\n  - strategy: ${a.strategy}`).join('\n') || '- none'),
    `\n## Column drift vs cfm — cfm cols absent in ${r.game}, one-directional (warn) (${r.sigDrift.length})\n` +
      (r.sigDrift.map((d) => `- ${d.cube} / ${d.table}: ${d.missingCols} cfm cols absent in ${r.game}`).join('\n') || '- none'),
    `\n## Stale "CFM" brand leak after relabel (review) (${r.cfmLeak.length})\n` +
      (r.cfmLeak.map((c) => `- ${c}`).join('\n') || '- none'),
    '',
  ];
  const out = lines.filter((l) => l !== '').join('\n');
  console.log(out);
  if (!r.opts.dryRun) {
    mkdirSync(REPORTS_DIR, { recursive: true });
    const path = join(REPORTS_DIR, `onboarding-${r.game}-${date}.md`);
    writeFileSync(path, out);
    console.error(`\nManifest written: ${path}`);
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
