/**
 * starter_question_sets store: migrate idempotency, get/upsert round-trip,
 * per-(workspace, game) partitioning.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import {
  getSet,
  upsertSet,
  type StarterQuestion,
} from '../../src/db/starter-questions-store.js';

const NOW = 1_780_000_000_000;

const QUESTIONS: StarterQuestion[] = [
  {
    id: 'dau-trend',
    text: 'How is DAU trending?',
    personaTags: ['pm'],
    categoryTags: ['explore'],
    targetCatalogIds: ['active_daily.dau'],
  },
];

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('starter-questions-store', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });

  it('migrate is idempotent (second run does not throw)', () => {
    expect(() => migrate(db)).not.toThrow();
  });

  it('getSet returns null before any upsert', () => {
    expect(getSet(db, 'local', 'cfm_vn')).toBeNull();
  });

  it('upsert + get round-trips the set', () => {
    upsertSet(db, {
      workspace: 'local', gameId: 'cfm_vn', metaHash: 'h1',
      source: 'template', questions: QUESTIONS, status: 'template',
    }, NOW);

    const row = getSet(db, 'local', 'cfm_vn');
    expect(row).not.toBeNull();
    expect(row!.meta_hash).toBe('h1');
    expect(row!.source).toBe('template');
    expect(row!.status).toBe('template');
    expect(row!.questions).toEqual(QUESTIONS);
    expect(row!.updated_at).toBe(NOW);
  });

  it('upsert replaces an existing row', () => {
    upsertSet(db, {
      workspace: 'local', gameId: 'cfm_vn', metaHash: 'h1',
      source: 'template', questions: QUESTIONS, status: 'template',
    }, NOW);
    upsertSet(db, {
      workspace: 'local', gameId: 'cfm_vn', metaHash: 'seed:v1',
      source: 'seed', questions: QUESTIONS, status: 'seed',
    }, NOW + 1000);

    const row = getSet(db, 'local', 'cfm_vn')!;
    expect(row.meta_hash).toBe('seed:v1');
    expect(row.source).toBe('seed');
    expect(row.status).toBe('seed');
    expect(row.updated_at).toBe(NOW + 1000);
  });

  it('rows are partitioned per (workspace, game)', () => {
    upsertSet(db, {
      workspace: 'local', gameId: 'cfm_vn', metaHash: 'h1',
      source: 'template', questions: QUESTIONS, status: 'template',
    }, NOW);
    expect(getSet(db, 'prod', 'cfm_vn')).toBeNull();
    expect(getSet(db, 'local', 'ballistar')).toBeNull();
  });
});
