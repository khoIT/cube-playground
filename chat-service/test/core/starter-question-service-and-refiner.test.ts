/**
 * getOrGenerateStarterQuestions orchestration + LLM refine pass:
 * cold miss → template baseline + background refine; stale-while-revalidate;
 * meta-failure → last saved set; LLM validation (invented member rejected,
 * fenced JSON tolerated); single-flight refine lease.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import { getSet, upsertSet } from '../../src/db/starter-questions-store.js';

const metaHolder: { meta: unknown; failVersion: boolean } = {
  meta: null,
  failVersion: false,
};

vi.mock('../../src/core/cube-meta-cache.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/cube-meta-cache.js')>();
  return {
    ...actual,
    getMeta: vi.fn(async () => {
      if (metaHolder.failVersion) throw new Error('upstream meta blip');
      return metaHolder.meta;
    }),
    getMetaVersion: vi.fn(async () => {
      if (metaHolder.failVersion) throw new Error('upstream meta blip');
      return actual.computeMetaVersion(metaHolder.meta);
    }),
  };
});

import { getOrGenerateStarterQuestions } from '../../src/core/starter-question-service.js';
import { parseAndValidateLlmSet } from '../../src/core/starter-question-refiner.js';
import { computeMetaVersion, extractMemberNames } from '../../src/core/cube-meta-cache.js';

function cube(name: string, measures: string[], dimensions: string[]) {
  return {
    name,
    measures: measures.map((m) => ({ name: `${name}.${m}`, type: 'number' })),
    dimensions: dimensions.map((d) => ({ name: `${name}.${d}`, type: 'string' })),
  };
}

const RICH_META = {
  cubes: [
    cube('mf_users',
      ['user_count', 'ltv_total_vnd', 'arpu_vnd'],
      ['payer_tier', 'days_since_last_active', 'churn_risk', 'lifecycle_stage', 'platform']),
    cube('active_daily', ['dau'], ['log_date']),
  ],
};

const SPARSE_META = { cubes: [cube('events_raw', [], ['event_name'])] };

const logger = { warn: vi.fn() };

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** LLM response echoing 12 valid questions built from real members. */
function validLlmJson(): string {
  const items = Array.from({ length: 12 }, (_, i) => ({
    id: `llm-q${i}`,
    text: `Refined question ${i}?`,
    personaTags: ['analyst'],
    categoryTags: ['explore'],
    targetCatalogIds: ['mf_users.payer_tier', 'mf_users.ltv_total_vnd'],
  }));
  return JSON.stringify(items);
}

async function settleBackground(): Promise<void> {
  // Refine runs via queueMicrotask + awaited async steps; a few macro-task
  // turns let it settle deterministically.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('getOrGenerateStarterQuestions', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
    metaHolder.meta = RICH_META;
    metaHolder.failVersion = false;
    logger.warn.mockClear();
  });

  it('cold miss: serves template baseline instantly and persists it', async () => {
    const callLlm = vi.fn(async () => validLlmJson());
    const res = await getOrGenerateStarterQuestions(db, {
      workspace: 'local', gameId: 'cfm_vn', logger, refinerDeps: { callLlm },
    });

    expect(res.source).toBe('template');
    expect(res.status).toBe('refining');
    expect(res.questions.length).toBeGreaterThanOrEqual(3);
    expect(getSet(db, 'local', 'cfm_vn')!.source).toBe('template');

    await settleBackground();
    // Background refine settled the LLM set.
    expect(callLlm).toHaveBeenCalledTimes(1);
    const settled = getSet(db, 'local', 'cfm_vn')!;
    expect(settled.source).toBe('llm');
    expect(settled.status).toBe('llm');
    expect(settled.questions[0].id).toBe('llm-q0');
  });

  it('fresh llm row: served as-is, no second refine', async () => {
    const callLlm = vi.fn(async () => validLlmJson());
    await getOrGenerateStarterQuestions(db, {
      workspace: 'local', gameId: 'cfm_vn', logger, refinerDeps: { callLlm },
    });
    await settleBackground();

    const res = await getOrGenerateStarterQuestions(db, {
      workspace: 'local', gameId: 'cfm_vn', logger, refinerDeps: { callLlm },
    });
    await settleBackground();

    expect(res.source).toBe('llm');
    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  it('stale row (schema changed): regenerates against the new hash', async () => {
    upsertSet(db, {
      workspace: 'local', gameId: 'cfm_vn', metaHash: 'old-hash',
      source: 'llm', status: 'llm',
      questions: [{ id: 'old', text: 'Old?', personaTags: ['pm'], categoryTags: ['explore'], targetCatalogIds: ['gone.member'] }],
    });

    const callLlm = vi.fn(async () => validLlmJson());
    const res = await getOrGenerateStarterQuestions(db, {
      workspace: 'local', gameId: 'cfm_vn', logger, refinerDeps: { callLlm },
    });

    expect(res.source).toBe('template');
    expect(res.metaHash).toBe(computeMetaVersion(RICH_META));
    await settleBackground();
    expect(getSet(db, 'local', 'cfm_vn')!.meta_hash).toBe(computeMetaVersion(RICH_META));
  });

  it('meta fetch failure with a saved row: serves the row unchanged', async () => {
    upsertSet(db, {
      workspace: 'local', gameId: 'cfm_vn', metaHash: 'h',
      source: 'llm', status: 'llm',
      questions: [{ id: 'keep', text: 'Keep?', personaTags: ['pm'], categoryTags: ['explore'], targetCatalogIds: ['mf_users.payer_tier'] }],
    });
    metaHolder.failVersion = true;

    const res = await getOrGenerateStarterQuestions(db, { workspace: 'local', gameId: 'cfm_vn', logger });
    expect(res.source).toBe('llm');
    expect(res.questions[0].id).toBe('keep');
  });

  it('meta fetch failure with no row: static-fallback', async () => {
    metaHolder.failVersion = true;
    const res = await getOrGenerateStarterQuestions(db, { workspace: 'local', gameId: 'cfm_vn', logger });
    expect(res.source).toBe('static-fallback');
    expect(res.questions).toEqual([]);
  });

  it('sparse schema (<3 template hits): static-fallback, nothing persisted', async () => {
    metaHolder.meta = SPARSE_META;
    const res = await getOrGenerateStarterQuestions(db, { workspace: 'local', gameId: 'tiny', logger });
    expect(res.source).toBe('static-fallback');
    expect(getSet(db, 'local', 'tiny')).toBeNull();
  });

  it('LLM set with an invented member is rejected wholesale; baseline retained', async () => {
    const callLlm = vi.fn(async () =>
      JSON.stringify([
        ...JSON.parse(validLlmJson()).slice(0, 11),
        {
          id: 'bad', text: 'Bad?', personaTags: ['pm'], categoryTags: ['explore'],
          targetCatalogIds: ['mf_users.invented_member'],
        },
      ]),
    );
    await getOrGenerateStarterQuestions(db, {
      workspace: 'local', gameId: 'cfm_vn', logger, refinerDeps: { callLlm },
    });
    await settleBackground();

    const row = getSet(db, 'local', 'cfm_vn')!;
    expect(row.source).toBe('template');
    expect(row.status).toBe('template');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('two concurrent cold requests take a single refine flight', async () => {
    const callLlm = vi.fn(async () => validLlmJson());
    await Promise.all([
      getOrGenerateStarterQuestions(db, { workspace: 'local', gameId: 'cfm_vn', logger, refinerDeps: { callLlm } }),
      getOrGenerateStarterQuestions(db, { workspace: 'local', gameId: 'cfm_vn', logger, refinerDeps: { callLlm } }),
    ]);
    await settleBackground();
    expect(callLlm).toHaveBeenCalledTimes(1);
  });
});

describe('parseAndValidateLlmSet', () => {
  const known = extractMemberNames(RICH_META);

  const item = (over: Record<string, unknown> = {}) => ({
    id: 'q1', text: 'Q?', personaTags: ['pm'], categoryTags: ['explore'],
    targetCatalogIds: ['mf_users.payer_tier'], ...over,
  });

  it('tolerates code-fenced JSON', () => {
    const raw = '```json\n' + JSON.stringify([item(), item({ id: 'q2' }), item({ id: 'q3' })]) + '\n```';
    expect(parseAndValidateLlmSet(raw, known)).toHaveLength(3);
  });

  it('rejects non-JSON / non-array output', () => {
    expect(parseAndValidateLlmSet('Sure! Here are questions…', known)).toBeNull();
    expect(parseAndValidateLlmSet('{"not":"array"}', known)).toBeNull();
  });

  it('drops items with bad tags but keeps valid ones', () => {
    const raw = JSON.stringify([
      item(), item({ id: 'q2' }), item({ id: 'q3' }),
      item({ id: 'bad-persona', personaTags: ['ceo'] }),
      item({ id: 'bad-category', categoryTags: ['hack'] }),
    ]);
    const out = parseAndValidateLlmSet(raw, known)!;
    expect(out.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('an invented member rejects the WHOLE set', () => {
    const raw = JSON.stringify([
      item(), item({ id: 'q2' }), item({ id: 'q3' }),
      item({ id: 'q4', targetCatalogIds: ['mf_users.fabricated'] }),
    ]);
    expect(parseAndValidateLlmSet(raw, known)).toBeNull();
  });

  it('fewer than 3 valid items rejects the set', () => {
    const raw = JSON.stringify([item(), item({ id: 'q2' })]);
    expect(parseAndValidateLlmSet(raw, known)).toBeNull();
  });
});
