import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { getRelations, invalidateReverseIndex } from '../src/services/concept-reverse-index.js';
import { migrateGlossarySeed } from '../src/db/glossary-migrate.js';
import { setRegistryDir, loadAll } from '../src/services/business-metrics-loader.js';

function readMigration(filename: string): string {
  for (const p of [
    resolve(process.cwd(), `src/db/migrations/${filename}`),
    resolve(process.cwd(), `server/src/db/migrations/${filename}`),
  ]) {
    try { return readFileSync(p, 'utf-8'); } catch { continue; }
  }
  throw new Error(`${filename} migration not found`);
}

/** In-memory DB with glossary + segments tables. The reverse index scopes
 *  segments by `workspace`, so add that column (migration 017 adds it in prod). */
function inMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readMigration('007-glossary.sql'));
  db.exec(readMigration('008-glossary-bilingual-and-status.sql'));
  db.exec(readMigration('015-glossary-concept-tier.sql'));
  db.exec(readMigration('027-glossary-unified-trust-visibility.sql'));
  db.exec(readMigration('001-init.sql'));
  db.exec(readMigration('004-game-scoping.sql'));
  db.exec(readMigration('011-segments-funnel.sql'));
  db.exec(`ALTER TABLE segments ADD COLUMN workspace TEXT NOT NULL DEFAULT 'local';`);
  return db;
}

const WS = 'local';

function insertSegment(
  db: Database.Database,
  opts: { id: string; name: string; workspace?: string; gameId?: string; predicate: unknown },
): void {
  db.prepare(
    `INSERT INTO segments (id, name, type, owner, game_id, status, predicate_tree_json, workspace)
     VALUES (?, ?, 'predicate', 'provenance-only', ?, 'fresh', ?, ?)`,
  ).run(
    opts.id,
    opts.name,
    opts.gameId ?? 'ptg',
    typeof opts.predicate === 'string' ? opts.predicate : JSON.stringify(opts.predicate),
    opts.workspace ?? WS,
  );
}

describe('concept-reverse-index', () => {
  let db: Database.Database;

  beforeEach(async () => {
    closeDb();
    db = inMemoryDb();
    setDb(db);
    migrateGlossarySeed(db);
    for (const dir of [
      resolve(process.cwd(), 'src/presets/business-metrics'),
      resolve(process.cwd(), 'server/src/presets/business-metrics'),
    ]) {
      try { setRegistryDir(dir); await loadAll(); break; } catch { continue; }
    }
  });

  afterEach(() => closeDb());

  it('returns null for unknown namespace / malformed ref', () => {
    expect(getRelations('unknown/foo', { workspaceId: WS, gameId: 'ptg' })).toBeNull();
    expect(getRelations('business_metrics/../../etc', { workspaceId: WS, gameId: 'ptg' })).toBeNull();
  });

  it('returns empty arrays for a well-formed but unconnected data_model ref', () => {
    const r = getRelations('data_model/nope_cube.field', { workspaceId: WS, gameId: 'ptg' });
    expect(r).not.toBeNull();
    expect(r?.metrics).toEqual([]);
    expect(r?.segments).toEqual([]);
    expect(r?.terms).toEqual([]);
  });

  it('finds metrics that reference a data_model field', () => {
    const r = getRelations('data_model/mf_users.acu', { workspaceId: WS, gameId: 'ptg' });
    const acu = r?.metrics.find((m) => m.id === 'acu');
    expect(acu).toBeTruthy();
    expect(acu?.label).toBe('ACU');
    expect(['draft', 'certified', 'deprecated']).toContain(acu?.trust);
  });

  it('finds segments that filter on a data_model field', () => {
    insertSegment(db, {
      id: 'seg_whale',
      name: 'Whale Payers',
      predicate: { filters: [{ member: 'mf_users.payer_tier', operator: 'equals', values: ['whale'] }] },
    });
    invalidateReverseIndex();
    const r = getRelations('data_model/mf_users.payer_tier', { workspaceId: WS, gameId: 'ptg' });
    expect(r?.segments.find((s) => s.id === 'seg_whale')?.name).toBe('Whale Payers');
  });

  it('does not leak segments across workspaces', () => {
    insertSegment(db, {
      id: 'seg_ws_a',
      name: 'Segment in WS-A',
      workspace: 'wsA',
      predicate: { filters: [{ member: 'mf_users.payer_tier', operator: 'equals', values: ['whale'] }] },
    });
    invalidateReverseIndex();
    // Different workspace → invisible.
    const inB = getRelations('data_model/mf_users.payer_tier', { workspaceId: 'wsB', gameId: 'ptg' });
    expect(inB?.segments.find((s) => s.id === 'seg_ws_a')).toBeUndefined();
    // Same workspace → visible.
    const inA = getRelations('data_model/mf_users.payer_tier', { workspaceId: 'wsA', gameId: 'ptg' });
    expect(inA?.segments.find((s) => s.id === 'seg_ws_a')).toBeTruthy();
  });

  it('returns the fields a business_metrics ref is built from', () => {
    const r = getRelations('business_metrics/acu', { workspaceId: WS, gameId: 'ptg' });
    expect(r?.fields.find((f) => f.member === 'mf_users.acu')).toBeTruthy();
  });

  it('returns empty fields for an unknown business_metrics ref', () => {
    const r = getRelations('business_metrics/__nope__', { workspaceId: WS, gameId: 'ptg' });
    expect(r?.fields).toEqual([]);
  });

  it('returns the fields a segment filters on', () => {
    insertSegment(db, {
      id: 'seg_multi',
      name: 'Multi Field',
      predicate: {
        filters: [
          { member: 'mf_users.payer_tier', operator: 'equals', values: ['whale'] },
          { member: 'mf_users.country', operator: 'contains', values: ['US'] },
        ],
      },
    });
    invalidateReverseIndex();
    const r = getRelations('segments/seg_multi', { workspaceId: WS, gameId: 'ptg' });
    expect(r?.fields.map((f) => f.member).sort()).toEqual(['mf_users.country', 'mf_users.payer_tier']);
  });

  it('term-edge shape is well-formed', () => {
    const r = getRelations('business_metrics/acu', { workspaceId: WS, gameId: 'ptg' });
    for (const t of r?.terms ?? []) {
      expect(t.ref).toMatch(/^glossary\//);
      expect(['draft', 'certified', 'deprecated']).toContain(t.trust);
    }
  });

  it('handles malformed predicate JSON gracefully (no crash, no members)', () => {
    insertSegment(db, { id: 'seg_bad', name: 'Bad JSON', predicate: '{not valid]' });
    invalidateReverseIndex();
    const r = getRelations('data_model/mf_users.payer_tier', { workspaceId: WS, gameId: 'ptg' });
    expect(r?.segments.find((s) => s.id === 'seg_bad')).toBeUndefined();
  });

  it('invalidateReverseIndex makes a newly-inserted segment visible', () => {
    const before = getRelations('data_model/mf_users.payer_tier', { workspaceId: WS, gameId: 'ptg' });
    expect(before?.segments.length).toBe(0);
    insertSegment(db, {
      id: 'seg_late',
      name: 'Late',
      predicate: { filters: [{ member: 'mf_users.payer_tier', operator: 'equals', values: ['whale'] }] },
    });
    // Stale cache — not yet visible.
    expect(
      getRelations('data_model/mf_users.payer_tier', { workspaceId: WS, gameId: 'ptg' })
        ?.segments.find((s) => s.id === 'seg_late'),
    ).toBeUndefined();
    invalidateReverseIndex();
    expect(
      getRelations('data_model/mf_users.payer_tier', { workspaceId: WS, gameId: 'ptg' })
        ?.segments.find((s) => s.id === 'seg_late')?.name,
    ).toBe('Late');
  });

  it('respects game_id scoping', () => {
    insertSegment(db, {
      id: 'seg_ptg', name: 'PTG', gameId: 'ptg',
      predicate: { filters: [{ member: 'mf_users.payer_tier', operator: 'equals', values: ['whale'] }] },
    });
    insertSegment(db, {
      id: 'seg_other', name: 'Other', gameId: 'other_game',
      predicate: { filters: [{ member: 'mf_users.payer_tier', operator: 'equals', values: ['minnow'] }] },
    });
    invalidateReverseIndex();
    const ptg = getRelations('data_model/mf_users.payer_tier', { workspaceId: WS, gameId: 'ptg' });
    expect(ptg?.segments.find((s) => s.id === 'seg_ptg')).toBeTruthy();
    expect(ptg?.segments.find((s) => s.id === 'seg_other')).toBeUndefined();
    const other = getRelations('data_model/mf_users.payer_tier', { workspaceId: WS, gameId: 'other_game' });
    expect(other?.segments.find((s) => s.id === 'seg_other')).toBeTruthy();
    expect(other?.segments.find((s) => s.id === 'seg_ptg')).toBeUndefined();
  });
});
