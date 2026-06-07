/**
 * Brief context assembler — card-cache reuse path (zero Cube queries when
 * fresh), staleness cutoff, limited fallback, plain-language predicate
 * summary (no cube member names leak), and tier-stat enrichment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, getDb, closeDb } from '../src/db/sqlite.js';
import { upsertCardCache } from '../src/services/card-cache-store.js';
import {
  assembleBriefContext,
  summarizePredicate,
} from '../src/services/segment-brief-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const TREE = JSON.stringify({
  kind: 'group', id: 'root', op: 'AND',
  children: [
    { kind: 'leaf', id: 'l1', member: 'mf_users.payer_tier', type: 'string', op: 'equals', values: ['whale'] },
    { kind: 'leaf', id: 'l2', member: 'mf_users.lifecycle_stage', type: 'string', op: 'in', values: ['churned', 'at_risk'] },
  ],
});

function insertSegment(id: string, overrides: Record<string, unknown> = {}) {
  getDb().prepare(`
    INSERT INTO segments (id, name, type, owner, cube, predicate_tree_json, cube_query_json,
                          uid_count, uid_list_json, game_id, workspace)
    VALUES (@id, @name, @type, @owner, @cube, @predicate_tree_json, @cube_query_json,
            @uid_count, @uid_list_json, @game_id, @workspace)
  `).run({
    id,
    name: 'Whale churn watch',
    type: 'predicate',
    owner: 'alice-sub',
    cube: 'mf_users',
    predicate_tree_json: TREE,
    cube_query_json: JSON.stringify({ measures: ['mf_users.user_count'], filters: [] }),
    uid_count: 1234,
    uid_list_json: '[]',
    game_id: 'ballistar',
    workspace: 'local',
    ...overrides,
  });
}

function segRowInput(id: string) {
  const row = getDb().prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
  return {
    id,
    name: row.name as string,
    type: row.type as string,
    cube: row.cube as string | null,
    game_id: row.game_id as string | null,
    workspace: row.workspace as string,
    uid_count: row.uid_count as number,
    predicate_tree_json: row.predicate_tree_json as string | null,
    cube_query_json: row.cube_query_json as string | null,
    member_tiers_json: row.member_tiers_json as string | null,
  };
}

describe('summarizePredicate', () => {
  it('renders plain-language conditions with cube prefixes stripped', () => {
    const conditions = summarizePredicate(TREE);
    expect(conditions).toEqual([
      'payer tier is whale',
      'lifecycle stage is one of churned, at_risk',
    ]);
  });

  it('parenthesizes nested OR groups', () => {
    const nested = JSON.stringify({
      kind: 'group', id: 'root', op: 'AND',
      children: [{
        kind: 'group', id: 'g1', op: 'OR',
        children: [
          { kind: 'leaf', id: 'a', member: 'mf_users.country', type: 'string', op: 'equals', values: ['VN'] },
          { kind: 'leaf', id: 'b', member: 'mf_users.country', type: 'string', op: 'equals', values: ['TH'] },
        ],
      }],
    });
    expect(summarizePredicate(nested)).toEqual(['(country is VN OR country is TH)']);
  });

  it('returns [] on null/malformed input', () => {
    expect(summarizePredicate(null)).toEqual([]);
    expect(summarizePredicate('{nope')).toEqual([]);
  });
});

describe('assembleBriefContext', () => {
  beforeEach(() => {
    setDb(makeMemDb());
  });
  afterEach(() => {
    closeDb();
  });

  it('reuses fresh card-cache rows — full coverage, business labels only', async () => {
    insertSegment('s1');
    upsertCardCache('s1', [
      { cardId: 'kpi:size', queryHash: 'h', rows: [{ 'mf_users.user_count': 1234 }], status: 'ok' },
      { cardId: 'kpi:ltv', queryHash: 'h', rows: [{ 'mf_users.ltv_total_vnd': 9_000_000 }], status: 'ok' },
      {
        cardId: 'card:overview:lifecycle-comp',
        queryHash: 'h',
        rows: [
          { 'mf_users.lifecycle_stage': 'churned', 'mf_users.user_count': 800 },
          { 'mf_users.lifecycle_stage': 'at_risk', 'mf_users.user_count': 434 },
        ],
        status: 'ok',
      },
    ]);

    const ctx = await assembleBriefContext(segRowInput('s1'));
    expect(ctx.data_coverage).toBe('full');
    expect(ctx.segment.member_count).toBe(1234);
    expect(ctx.segment.conditions).toContain('payer tier is whale');
    expect(ctx.enrichment?.kpis).toContainEqual({ label: 'Size', value: 1234, format: 'compact' });
    expect(ctx.enrichment?.kpis).toContainEqual({ label: 'LTV total', value: 9_000_000, format: 'currency' });
    const lifecycle = ctx.enrichment?.distributions.find((d) => d.label === 'Lifecycle stage');
    expect(lifecycle?.top[0]).toEqual({ value: 'churned', count: 800 });
    // No raw Cube member names anywhere in the serialized context.
    expect(JSON.stringify(ctx)).not.toContain('mf_users.');
  });

  it('ignores stale card-cache rows (manual segment → limited, no inline run)', async () => {
    insertSegment('s2', { type: 'manual', predicate_tree_json: null, cube_query_json: null });
    upsertCardCache('s2', [
      { cardId: 'kpi:size', queryHash: 'h', rows: [{ 'mf_users.user_count': 50 }], status: 'ok' },
    ]);
    getDb().prepare('UPDATE segment_card_cache SET fetched_at = ? WHERE segment_id = ?')
      .run(new Date(Date.now() - 48 * 3600_000).toISOString(), 's2');

    const ctx = await assembleBriefContext(segRowInput('s2'));
    expect(ctx.enrichment).toBeNull();
    expect(ctx.data_coverage).toBe('limited');
  });

  it('degrades to limited for a cube with no preset (non-mf_users game)', async () => {
    insertSegment('s3', { cube: 'some_random_cube', cube_query_json: null });
    const ctx = await assembleBriefContext(segRowInput('s3'));
    expect(ctx.enrichment).toBeNull();
    expect(ctx.data_coverage).toBe('limited');
    expect(ctx.segment.conditions.length).toBeGreaterThan(0); // predicate-only context survives
  });

  it('includes median tier LTV stats when member tiers are stored', async () => {
    insertSegment('s4');
    getDb().prepare('UPDATE segments SET member_tiers_json = ? WHERE id = ?').run(
      JSON.stringify({
        ltv_measure: 'mf_users.ltv_total_vnd',
        computed_at: new Date().toISOString(),
        tiers: {
          top: [{ uid: 'a', ltv: 100 }, { uid: 'b', ltv: 300 }, { uid: 'c', ltv: 500 }],
          bottom: [{ uid: 'x', ltv: 1 }, { uid: 'y', ltv: 3 }, { uid: 'z', ltv: 5 }],
        },
      }),
      's4',
    );
    const ctx = await assembleBriefContext(segRowInput('s4'));
    expect(ctx.tier_stats).toEqual({ top_median_ltv: 300, bottom_median_ltv: 3 });
  });
});
