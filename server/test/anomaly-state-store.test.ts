/**
 * Tests for Phase-2 SQLite methods: upsertAnomaly, listAnomalies, setAnomalyStatus.
 * Uses an in-memory SQLite database seeded with all migrations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { setDb, closeDb } from '../src/db/sqlite.js';
import {
  upsertAnomaly,
  listAnomalies,
  setAnomalyStatus,
} from '../src/services/anomaly-state-store.js';

const MIGRATIONS_DIR = join(dirname(import.meta.url.replace('file://', '')), '..', 'src', 'db', 'migrations');

function buildTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f: string) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe('upsertAnomaly', () => {
  let db: Database.Database;

  beforeEach(() => { db = buildTestDb(); setDb(db); });
  afterEach(() => closeDb());

  it('inserts a new anomaly row', () => {
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'high', baseline: 1000, observed: 5000, ts: '2024-01-15' });
    expect(listAnomalies('cfm', 'open')).toHaveLength(1);
  });

  it('is idempotent on (game, metric, ts) — no duplicate row', () => {
    const input = { game: 'cfm', metric: 'active_daily.dau', severity: 'med' as const, baseline: 1000, observed: 3000, ts: '2024-01-15' };
    upsertAnomaly(input);
    upsertAnomaly(input);
    expect(listAnomalies('cfm', 'open')).toHaveLength(1);
  });

  it('updates severity on conflict without creating duplicate', () => {
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'low', baseline: 1000, observed: 2100, ts: '2024-01-15' });
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'high', baseline: 1000, observed: 6000, ts: '2024-01-15' });
    const rows = listAnomalies('cfm', 'open');
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('high');
  });

  it('inserts distinct rows for different ts values', () => {
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'med', baseline: 1000, observed: 3000, ts: '2024-01-14' });
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'high', baseline: 1000, observed: 5000, ts: '2024-01-15' });
    expect(listAnomalies('cfm', 'open')).toHaveLength(2);
  });

  it('does not reset status when re-upserting an ack-d row', () => {
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'med', baseline: 1000, observed: 3500, ts: '2024-01-15' });
    setAnomalyStatus(listAnomalies('cfm', 'open')[0].id, 'ack');
    // Re-upsert same point — status must remain 'ack'
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'high', baseline: 1000, observed: 4000, ts: '2024-01-15' });
    expect(listAnomalies('cfm', 'open')).toHaveLength(0);
    expect(listAnomalies('cfm', 'ack')).toHaveLength(1);
  });
});

describe('listAnomalies ordering', () => {
  let db: Database.Database;

  beforeEach(() => { db = buildTestDb(); setDb(db); });
  afterEach(() => closeDb());

  it('returns rows sorted high > med > low', () => {
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau',               severity: 'low',  baseline: 1000, observed: 2100, ts: '2024-01-13' });
    upsertAnomaly({ game: 'cfm', metric: 'user_recharge_daily.revenue_vnd_total', severity: 'high', baseline: 500,  observed: 3000, ts: '2024-01-15' });
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau',               severity: 'med',  baseline: 1000, observed: 3200, ts: '2024-01-14' });
    const rows = listAnomalies('cfm', 'open');
    expect(rows.map((r) => r.severity)).toEqual(['high', 'med', 'low']);
  });

  it('filters by game', () => {
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'high', baseline: 1000, observed: 5000, ts: '2024-01-15' });
    upsertAnomaly({ game: 'jus', metric: 'active_daily.dau', severity: 'med',  baseline: 900,  observed: 2800, ts: '2024-01-15' });
    expect(listAnomalies('cfm', 'open')).toHaveLength(1);
    expect(listAnomalies('jus', 'open')).toHaveLength(1);
  });

  it('defaults to open status when not provided', () => {
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'med', baseline: 1000, observed: 3000, ts: '2024-01-15' });
    expect(listAnomalies('cfm')).toHaveLength(1);
  });
});

describe('listAnomalies snooze expiry', () => {
  let db: Database.Database;

  beforeEach(() => { db = buildTestDb(); setDb(db); });
  afterEach(() => closeDb());

  it('re-opens expired snoozed row', () => {
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'med', baseline: 1000, observed: 3000, ts: '2024-01-15' });
    const [row] = listAnomalies('cfm', 'open');
    setAnomalyStatus(row.id, 'snoozed', new Date(Date.now() - 1000).toISOString());
    expect(listAnomalies('cfm', 'snoozed')).toHaveLength(0);
    expect(listAnomalies('cfm', 'open')).toHaveLength(1);
  });

  it('keeps future-snoozed row hidden from open list', () => {
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'med', baseline: 1000, observed: 3000, ts: '2024-01-15' });
    const [row] = listAnomalies('cfm', 'open');
    setAnomalyStatus(row.id, 'snoozed', new Date(Date.now() + 60_000).toISOString());
    expect(listAnomalies('cfm', 'open')).toHaveLength(0);
    expect(listAnomalies('cfm', 'snoozed')).toHaveLength(1);
  });
});

describe('setAnomalyStatus transitions', () => {
  let db: Database.Database;

  beforeEach(() => { db = buildTestDb(); setDb(db); });
  afterEach(() => closeDb());

  it('open → ack: disappears from open, appears in ack', () => {
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'high', baseline: 1000, observed: 5000, ts: '2024-01-15' });
    const [row] = listAnomalies('cfm', 'open');
    setAnomalyStatus(row.id, 'ack');
    expect(listAnomalies('cfm', 'open')).toHaveLength(0);
    expect(listAnomalies('cfm', 'ack')).toHaveLength(1);
  });

  it('ack → open transition is valid', () => {
    upsertAnomaly({ game: 'cfm', metric: 'active_daily.dau', severity: 'high', baseline: 1000, observed: 5000, ts: '2024-01-15' });
    const [row] = listAnomalies('cfm', 'open');
    setAnomalyStatus(row.id, 'ack');
    setAnomalyStatus(row.id, 'open');
    expect(listAnomalies('cfm', 'open')).toHaveLength(1);
    expect(listAnomalies('cfm', 'ack')).toHaveLength(0);
  });
});
