#!/usr/bin/env node
/**
 * Port cube-dev per-game models into a single-deployment Cube Cloud model.
 *
 * cube-dev runs one deployment PER game, so its cubes use bare names
 * (`game_key_metrics`) and bare table refs (`cons_game_key_metrics_daily`)
 * resolved by a per-game Trino schema. Cube Cloud here is ONE deployment over
 * ONE schema (`stag_iceberg.khoitn`) with flat game-prefixed tables, so every
 * game's cubes compile together. That forces two rewrites:
 *
 *   1. Namespace every cube + cube-ref by game  →  cfm_vn_game_key_metrics,
 *      so cfm and jus don't collide on the same cube name.
 *   2. Fully-qualify physical tables             →  stag_iceberg.khoitn.cfm_vn__<table>.
 *
 * Plus two simplifications for a clean first push:
 *   3. Drop joins to cubes outside the starter set (e.g. mf_users → recharge).
 *   4. Strip pre_aggregations (last block in each file) — not needed for Explore
 *      to work, and avoids Cube Store build load/failures on a Shared tier.
 *
 * Output: <outdir>/model/cubes/<ns>/*.yml + <outdir>/model/views/<ns>_views.yml
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'cube-dev/cube/model/cubes');
const OUT = process.argv[2] ?? join(process.cwd(), 'cube-cloud-model');

// Game dir → namespace (used for BOTH cube-name prefix and table prefix).
const GAMES = [
  { dir: 'cfm', ns: 'cfm_vn' },
  { dir: 'jus', ns: 'jus_vn' },
];

// The starter set of cubes ported per game (bare cube name = source filename).
const IN_SET = ['game_key_metrics', 'mf_users', 'active_daily', 'user_recharge_daily', 'new_user_retention'];

// Physical tables referenced by the starter set — qualified to stag_iceberg.khoitn.<ns>__<table>.
const TABLES = [
  'cons_game_key_metrics_daily',
  'mf_users',
  'mf_ingame_roles',
  'std_ingame_user_active_daily',
  'std_ingame_user_recharge_daily',
  'cons_game_new_user_retention_daily',
];

/** Cut the file at the first top-level `pre_aggregations:` block (it is the last block). */
function stripPreAggs(text) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^    pre_aggregations:\s*$/.test(l));
  if (i === -1) return text;
  // Trim trailing blank/comment lines that introduced the rollup section.
  let end = i;
  while (end > 0 && /^\s*(#.*)?$/.test(lines[end - 1])) end--;
  return lines.slice(0, end).join('\n').replace(/\s+$/, '') + '\n';
}

/**
 * Within the joins block only: drop entries whose target cube is outside the
 * starter set, and prefix kept join target names by ns (a join's `name` IS the
 * joined cube name, so it must track the cube rename). Scoped to the joins
 * block so identically-named dimensions/measures are never touched.
 */
function rewriteJoins(text, ns) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^    joins:\s*$/.test(l));
  if (start === -1) return text;
  let end = start + 1;
  while (end < lines.length && !/^    \S/.test(lines[end])) end++; // until next 4-space key
  const block = lines.slice(start + 1, end);
  const kept = [];
  let i = 0;
  while (i < block.length) {
    const m = block[i].match(/^      - name:\s*(\S+)/);
    if (m) {
      const entry = [block[i].replace(/(- name:\s*)(\S+)/, `$1${ns}_$2`)];
      let j = i + 1;
      while (j < block.length && !/^      - name:/.test(block[j])) { entry.push(block[j]); j++; }
      if (IN_SET.includes(m[1])) kept.push(...entry);
      i = j;
    } else { kept.push(block[i]); i++; }
  }
  return [...lines.slice(0, start + 1), ...kept, ...lines.slice(end)].join('\n');
}

function port(text, ns) {
  text = stripPreAggs(text);
  text = rewriteJoins(text, ns);
  // (1) cube self-name: `  - name: <cube>` (exactly 2-space indent).
  for (const c of IN_SET) {
    text = text.replace(new RegExp(`^  - name: ${c}\\s*$`, 'm'), `  - name: ${ns}_${c}`);
  }
  // (1) cube refs `{<cube>}` inside join SQL etc. — only known cube names.
  for (const c of IN_SET) {
    text = text.replace(new RegExp(`\\{${c}\\}`, 'g'), `{${ns}_${c}}`);
  }
  // (2) physical tables: sql_table + FROM/JOIN in raw SQL.
  for (const t of TABLES) {
    const q = `stag_iceberg.khoitn.${ns}__${t}`;
    text = text.replace(new RegExp(`(sql_table:\\s*)${t}\\b`, 'g'), `$1${q}`);
    text = text.replace(new RegExp(`\\b(FROM|JOIN)\\s+${t}\\b`, 'g'), `$1 ${q}`);
  }
  return text;
}

let count = 0;
for (const { dir, ns } of GAMES) {
  mkdirSync(join(OUT, 'model/cubes', ns), { recursive: true });
  const views = ['views:'];
  for (const c of IN_SET) {
    const src = readFileSync(join(SRC, dir, `${c}.yml`), 'utf8');
    writeFileSync(join(OUT, 'model/cubes', ns, `${c}.yml`), port(src, ns));
    count++;
    // One single-cube wildcard view per cube — robust, lights up Explore.
    views.push(`  - name: ${ns}_${c}_view`);
    views.push(`    cubes:`);
    views.push(`      - join_path: ${ns}_${c}`);
    views.push(`        includes: "*"`);
  }
  mkdirSync(join(OUT, 'model/views'), { recursive: true });
  writeFileSync(join(OUT, 'model/views', `${ns}_views.yml`), views.join('\n') + '\n');
}
console.error(`Ported ${count} cubes + ${GAMES.length} view files → ${OUT}`);
