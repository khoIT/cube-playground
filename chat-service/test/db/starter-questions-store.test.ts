/**
 * starter_question_sets store: migrate idempotency, get/upsert round-trip,
 * refine-lease single-flight semantics (free → taken → expired-reclaim).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import {
  getSet,
  upsertSet,
  tryAcquireRefineLease,
  releaseRefineLease,
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
      source: 'template', questions: QUESTIONS, status: 'refining',
    }, NOW);

    const row = getSet(db, 'local', 'cfm_vn');
    expect(row).not.toBeNull();
    expect(row!.meta_hash).toBe('h1');
    expect(row!.source).toBe('template');
    expect(row!.status).toBe('refining');
    expect(row!.questions).toEqual(QUESTIONS);
    expect(row!.updated_at).toBe(NOW);
  });

  it('upsert replaces an existing row but preserves a held lease', () => {
    upsertSet(db, {
      workspace: 'local', gameId: 'cfm_vn', metaHash: 'h1',
      source: 'template', questions: QUESTIONS, status: 'refining',
    }, NOW);
    expect(tryAcquireRefineLease(db, 'local', 'cfm_vn', 60_000, NOW)).toBe(true);

    // A concurrent template write must not wipe the in-flight lease —
    // otherwise two cold requests double-fire the LLM refine.
    upsertSet(db, {
      workspace: 'local', gameId: 'cfm_vn', metaHash: 'h2',
      source: 'llm', questions: QUESTIONS, status: 'llm',
    }, NOW + 1000);

    const row = getSet(db, 'local', 'cfm_vn')!;
    expect(row.meta_hash).toBe('h2');
    expect(row.source).toBe('llm');
    expect(row.inflight_until).toBe(NOW + 60_000);
    expect(tryAcquireRefineLease(db, 'local', 'cfm_vn', 60_000, NOW + 1)).toBe(false);
  });

  it('rows are partitioned per (workspace, game)', () => {
    upsertSet(db, {
      workspace: 'local', gameId: 'cfm_vn', metaHash: 'h1',
      source: 'template', questions: QUESTIONS, status: 'template',
    }, NOW);
    expect(getSet(db, 'prod', 'cfm_vn')).toBeNull();
    expect(getSet(db, 'local', 'ballistar')).toBeNull();
  });

  it('lease: second acquire fails while held, succeeds after expiry', () => {
    upsertSet(db, {
      workspace: 'local', gameId: 'cfm_vn', metaHash: 'h1',
      source: 'template', questions: QUESTIONS, status: 'refining',
    }, NOW);

    expect(tryAcquireRefineLease(db, 'local', 'cfm_vn', 60_000, NOW)).toBe(true);
    expect(tryAcquireRefineLease(db, 'local', 'cfm_vn', 60_000, NOW + 1)).toBe(false);
    // Expired lease is reclaimable — a crashed refine never wedges generation.
    expect(tryAcquireRefineLease(db, 'local', 'cfm_vn', 60_000, NOW + 61_000)).toBe(true);
  });

  it('releaseRefineLease frees the lease without touching the set', () => {
    upsertSet(db, {
      workspace: 'local', gameId: 'cfm_vn', metaHash: 'h1',
      source: 'template', questions: QUESTIONS, status: 'refining',
    }, NOW);
    tryAcquireRefineLease(db, 'local', 'cfm_vn', 60_000, NOW);
    releaseRefineLease(db, 'local', 'cfm_vn');

    expect(tryAcquireRefineLease(db, 'local', 'cfm_vn', 60_000, NOW + 1)).toBe(true);
    expect(getSet(db, 'local', 'cfm_vn')!.questions).toEqual(QUESTIONS);
  });

  it('lease acquire on a missing row returns false', () => {
    expect(tryAcquireRefineLease(db, 'local', 'nope', 60_000, NOW)).toBe(false);
  });
});
