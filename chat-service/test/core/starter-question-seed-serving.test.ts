/**
 * Seed short-circuit in getOrGenerateStarterQuestions: a game present in the
 * pregenerated seed file is served verbatim — no template pass, no refine,
 * no meta_hash invalidation (works even when meta is unreachable) — and the
 * DB row is upserted with source='seed' for inspectability.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import { getSet } from '../../src/db/starter-questions-store.js';
import type { StarterSeedHit } from '../../src/db/starter-questions-seed.js';

const seedHolder: { hit: StarterSeedHit | null } = { hit: null };

vi.mock('../../src/db/starter-questions-seed.js', () => ({
  getSeedEntry: vi.fn(() => seedHolder.hit),
}));

const metaHolder: { fail: boolean } = { fail: false };

vi.mock('../../src/core/cube-meta-cache.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/cube-meta-cache.js')>();
  return {
    ...actual,
    getMeta: vi.fn(async () => {
      if (metaHolder.fail) throw new Error('meta unreachable');
      return { cubes: [] };
    }),
    getMetaVersion: vi.fn(async () => {
      if (metaHolder.fail) throw new Error('meta unreachable');
      return 'live-hash';
    }),
  };
});

import { getOrGenerateStarterQuestions } from '../../src/core/starter-question-service.js';

const QUESTIONS = [
  {
    id: 'seed-q1',
    text: 'Where are players sinking their currency in the most recent month of data?',
    topicTags: ['monetization' as const],
    categoryTags: ['explore' as const],
    targetCatalogIds: ['etl_money_flow.total_out'],
  },
  {
    id: 'seed-q2',
    text: 'Which payer tier drives revenue?',
    topicTags: ['liveops' as const],
    categoryTags: ['compare' as const],
    targetCatalogIds: ['mf_users.payer_tier'],
  },
  {
    id: 'seed-q3',
    text: 'How is retention trending?',
    topicTags: ['user_acquisition' as const],
    categoryTags: ['diagnose' as const],
    targetCatalogIds: ['new_user_retention.rnru_d7'],
  },
];

const logger = { warn: vi.fn() };

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('starter-question seed serving', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
    metaHolder.fail = false;
    seedHolder.hit = {
      version: '260606-0001',
      generatedAt: 1780000000000,
      entry: { questions: QUESTIONS, coverage: { 'etl_money_flow.log_date': '2026-04-30' } },
    };
    vi.clearAllMocks();
  });

  it('serves the seed verbatim and upserts a source=seed row', async () => {
    const res = await getOrGenerateStarterQuestions(db, {
      workspace: 'local', gameId: 'cfm_vn', logger,
    });
    expect(res.questions).toEqual(QUESTIONS);
    expect(res.source).toBe('llm'); // FE-compatible reporting
    expect(res.metaHash).toBe('seed:260606-0001');
    expect(res.generatedAt).toBe(1780000000000);

    const row = getSet(db, 'local', 'cfm_vn');
    expect(row?.source).toBe('seed');
    expect(row?.status).toBe('seed');
    expect(row?.questions).toEqual(QUESTIONS);
  });

  it('serves the seed even when meta is unreachable (no meta dependency)', async () => {
    metaHolder.fail = true;
    const res = await getOrGenerateStarterQuestions(db, {
      workspace: 'prod', gameId: 'cfm_vn', logger,
    });
    expect(res.questions).toEqual(QUESTIONS);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('identical responses across workspaces — the consistency contract', async () => {
    const a = await getOrGenerateStarterQuestions(db, { workspace: 'local', gameId: 'cfm_vn', logger });
    const b = await getOrGenerateStarterQuestions(db, { workspace: 'prod', gameId: 'cfm_vn', logger });
    expect(a.questions).toEqual(b.questions);
    expect(a.metaHash).toBe(b.metaHash);
  });

  it('falls through to the dynamic pipeline when the game is not in the seed', async () => {
    seedHolder.hit = null;
    const res = await getOrGenerateStarterQuestions(db, {
      workspace: 'local', gameId: 'unseeded-game', logger,
    });
    // Empty meta → sparse → static fallback; the point is the seed path did
    // not hijack a non-seeded game.
    expect(res.source).toBe('static-fallback');
  });
});
