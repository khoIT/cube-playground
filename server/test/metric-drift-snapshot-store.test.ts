/**
 * Store tests for metric_drift_snapshot. Real :memory: DB seeded with all
 * migrations (never top-level env mutation — see lessons-learned).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { upsertDriftRows, listDriftRows } from '../src/db/metric-drift-snapshot-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function buildDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

let db: Database.Database;
beforeEach(() => { db = buildDb(); });
afterEach(() => db.close());

const ROW = (id: string, ref: string) => ({ metricId: id, ref, reason: 'cube-missing' as const });

describe('upsertDriftRows / listDriftRows', () => {
  it('replace-per-(workspace,game,source): a shrinking set leaves only the latest rows', () => {
    upsertDriftRows(db, { workspaceId: 'local', game: 'ptg', source: 'detector', rows: [ROW('a', 'x.a'), ROW('b', 'x.b')] });
    expect(listDriftRows(db, { workspaceId: 'local', game: 'ptg', source: 'detector' })).toHaveLength(2);

    upsertDriftRows(db, { workspaceId: 'local', game: 'ptg', source: 'detector', rows: [ROW('a', 'x.a')] });
    const rows = listDriftRows(db, { workspaceId: 'local', game: 'ptg', source: 'detector' });
    expect(rows).toHaveLength(1);
    expect(rows[0].metricId).toBe('a');
  });

  it('rows:[] clears a now-resolved scope', () => {
    upsertDriftRows(db, { workspaceId: 'local', game: 'ptg', source: 'detector', rows: [ROW('a', 'x.a')] });
    upsertDriftRows(db, { workspaceId: 'local', game: 'ptg', source: 'detector', rows: [] });
    expect(listDriftRows(db, { workspaceId: 'local', game: 'ptg', source: 'detector' })).toHaveLength(0);
  });

  it('detector + live rows for the same game coexist (different source)', () => {
    upsertDriftRows(db, { workspaceId: 'local', game: 'ptg', source: 'detector', rows: [ROW('a', 'x.a')] });
    upsertDriftRows(db, { workspaceId: 'local', game: 'ptg', source: 'live', rows: [ROW('b', 'x.b')] });
    expect(listDriftRows(db, { game: 'ptg', source: 'detector' })).toHaveLength(1);
    expect(listDriftRows(db, { game: 'ptg', source: 'live' })).toHaveLength(1);
  });

  it("two workspaces' live rows for the same game coexist (drift is workspace-independent)", () => {
    upsertDriftRows(db, { workspaceId: 'wsA', game: 'ptg', source: 'live', rows: [ROW('a', 'x.a')] });
    upsertDriftRows(db, { workspaceId: 'wsB', game: 'ptg', source: 'live', rows: [ROW('b', 'x.b'), ROW('c', 'x.c')] });
    // Replacing wsB must not touch wsA.
    upsertDriftRows(db, { workspaceId: 'wsB', game: 'ptg', source: 'live', rows: [ROW('b', 'x.b')] });
    expect(listDriftRows(db, { workspaceId: 'wsA', game: 'ptg', source: 'live' })).toHaveLength(1);
    expect(listDriftRows(db, { workspaceId: 'wsB', game: 'ptg', source: 'live' })).toHaveLength(1);
  });

  it('list scope filters by any subset of the key', () => {
    upsertDriftRows(db, { workspaceId: 'local', game: 'ptg', source: 'detector', rows: [ROW('a', 'x.a')] });
    upsertDriftRows(db, { workspaceId: 'local', game: 'cfm', source: 'detector', rows: [ROW('b', 'x.b')] });
    expect(listDriftRows(db, { workspaceId: 'local' })).toHaveLength(2);
    expect(listDriftRows(db, { game: 'cfm' })).toHaveLength(1);
  });
});
