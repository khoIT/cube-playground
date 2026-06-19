/**
 * Generate the blessed segmentable-measures catalog from a declarative seed.
 *
 *   node scripts/derive-segmentable-measures.mjs        # write the catalog
 *   node scripts/derive-segmentable-measures.mjs --check # fail if it would change
 *
 * The catalog maps a measure *concept* (spend / spend_usd / active_days) to the
 * per-USER dimension that carries it, plus everything the percentile cutoff
 * needs: the logical Cube member (for the membership query), the physical Trino
 * table+column (for `approx_percentile`), the default reference population
 * (payers, for spend), and the per-user identity merge for multi-row marts (jus).
 *
 * It is deterministic + re-runnable: the committed JSON is exactly this output,
 * so `--check` guards against drift in CI. Adding a game = add a row to GAMES;
 * adding a concept = add a row to CONCEPTS. Anything subtler (a game whose model
 * breaks the naming convention) is hand-edited in the JSON and the seed updated
 * to match — the JSON stays the source of truth.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'data', 'segmentable-measures.json');

// Trino catalog + per-game schema (mirrors trino-profiler-config GAME_SCHEMA).
const CATALOG = 'game_integration';
const GAMES = [
  { game: 'cfm_vn', schema: 'cfm_vn', identityMerge: null },
  // jus's raw mf_users carries two rows per user (dual identity namespace); the
  // cube collapses them with split_part(user_id,'@',1)+max+GROUP BY, so the
  // cutoff query must do the same or it double-counts.
  { game: 'jus_vn', schema: 'jus_vn', identityMerge: { idColumn: 'user_id', transform: 'split_part_at', agg: 'max' } },
];

// concept → { logical dimension, physical column, window, currency, payerScoped }
// `payerScoped` spend concepts default their population to "<column> > 0": an
// unscoped percentile of recharge is 0 (free users dominate) and selects everyone.
const CONCEPTS = [
  { concept: 'spend', label: 'Total spend (lifetime, VND)', dim: 'ltv_vnd', column: 'ingame_total_recharge_value_vnd', window: 'lifetime', currency: 'vnd', payerScoped: true },
  { concept: 'spend_30d', label: 'Spend, last 30 days (VND)', dim: 'ltv_30d_vnd', column: 'ingame_total_recharge_value_vnd_30d', window: '30d', currency: 'vnd', payerScoped: true },
  { concept: 'spend_usd', label: 'Total spend (lifetime, USD)', dim: 'ltv_usd', column: 'ingame_total_recharged_value_usd', window: 'lifetime', currency: 'usd', payerScoped: true },
  { concept: 'active_days', label: 'Total active days (lifetime)', dim: 'total_active_days', column: 'ingame_total_active_days', window: 'lifetime', currency: null, payerScoped: false },
];

const CUBE = 'mf_users';

function buildCatalog() {
  const entries = [];
  for (const g of GAMES) {
    const physicalTable = `${CATALOG}.${g.schema}.${CUBE}`;
    for (const c of CONCEPTS) {
      entries.push({
        game: g.game,
        concept: c.concept,
        label: c.label,
        cube: CUBE,
        dimension: `${CUBE}.${c.dim}`,
        window: c.window,
        currency: c.currency,
        physicalTable,
        physicalColumn: c.column,
        // Default reference population the cutoff is computed over. Payers-only
        // for spend; the full table for non-degenerate concepts (active days).
        defaultPopulation: c.payerScoped
          ? { kind: 'leaf', id: 'pop', member: c.column, type: 'number', op: 'gt', values: [0] }
          : null,
        identityMerge: g.identityMerge,
        confidence: 1,
      });
    }
  }
  return { version: 1, entries };
}

const next = JSON.stringify(buildCatalog(), null, 2) + '\n';

if (process.argv.includes('--check')) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== next) {
    console.error('segmentable-measures.json is stale — run `node scripts/derive-segmentable-measures.mjs`.');
    process.exit(1);
  }
  console.log('segmentable-measures.json up to date.');
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, next);
  console.log(`Wrote ${OUT} (${buildCatalog().entries.length} entries).`);
}
