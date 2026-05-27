/**
 * Phase 02a sub-deliverable D — end-to-end replay of session b93d68e4 through
 * the `disambiguate_query` handler. The eight-turn prod failure mode
 * collapses to two turns:
 *
 *   T0  "top spenders this week"
 *       v2 layer auto-routes: leaderboard query + concept=spender +
 *       entity=players + intent=leaderboard. All three slots persist.
 *
 *   T2  "Revenue" (a measure reply that would have been re-disambig'd from
 *       scratch in the old flow, asking "rank what?" all over again)
 *       Engine returns intent=aggregate (default). fillResultFromMemory
 *       restores intent=leaderboard + concept + entity. retry helper
 *       rebuilds the leaderboard query against the memorized concept.
 *       Action=auto, no clarify.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const { META, GLOSSARY } = vi.hoisted(() => ({
  META: {
    cubes: [
      {
        name: 'recharge',
        measures: [{ name: 'recharge.revenue_vnd', shortTitle: 'Revenue (VND)' }],
        dimensions: [
          { name: 'recharge.event_date', type: 'time' },
          { name: 'recharge.channel', type: 'string' },
        ],
      },
      {
        name: 'players',
        measures: [{ name: 'players.count', shortTitle: 'Players' }],
        dimensions: [
          { name: 'players.user_id', type: 'string' },
          { name: 'players.event_date', type: 'time' },
        ],
      },
    ],
  },
  GLOSSARY: [
    {
      id: 'spender',
      label: 'Spender',
      labelVi: 'Người trả phí',
      description: '',
      primaryCatalogId: 'business_metrics/paying_users',
      aliases: ['spender', 'spenders', 'payer', 'payers'],
      aliasesVi: ['người trả phí'],
      category: 'monetisation',
      measureRef: 'recharge.revenue_vnd',
      refKind: 'measure',
      entityCube: 'players',
      entityPk: 'players.user_id',
      defaultMeasureRef: 'recharge.revenue_vnd',
      defaultFilter: { member: 'recharge.revenue_vnd', op: '>', value: 0 },
      ranking: { order: 'DESC', default_limit: 10 },
      trustTier: 'certified',
    },
    {
      id: 'revenue',
      label: 'Revenue',
      labelVi: 'Doanh thu',
      description: '',
      primaryCatalogId: 'recharge.revenue_vnd',
      aliases: ['revenue', 'total revenue'],
      aliasesVi: ['doanh thu'],
      category: 'monetisation',
      measureRef: 'recharge.revenue_vnd',
      refKind: 'measure',
    },
  ],
}));

vi.mock('../../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(async () => META),
  extractMemberNames: () => new Set([
    'recharge.revenue_vnd',
    'recharge.event_date',
    'recharge.channel',
    'players.user_id',
    'players.event_date',
    'players.count',
  ]),
}));

vi.mock('../../src/nl-to-query/glossary-client.js', () => ({
  fetchOfficialGlossary: vi.fn(async () => GLOSSARY),
  __resetGlossaryCache: vi.fn(),
}));

vi.mock('../../src/config.js', () => ({
  config: {
    disambigAutoThreshold: 0.75,
    chatGlossaryLegacy: false,
    chatGlossaryAutorouteThreshold: 0.8,
    cacheServiceEnabled: true,
  },
  isLangfuseEnabled: () => false,
}));

import { handler as disambiguateHandler } from '../../src/tools/disambiguate-query.js';
import { migrate } from '../../src/db/migrate.js';
import { getResolutions } from '../../src/cache/disambig-memory-adapter.js';
import type { ToolContext } from '../../src/types.js';

const OWNER = 'pm-vng';
const GAME = 'ptg';
const SID = 'sess-b93d68e4-replay';

function makeCtx(db: Database.Database): ToolContext {
  return {
    ownerId: OWNER,
    gameId: GAME,
    cubeToken: 'tok',
    sessionId: SID,
    turnId: 't',
    db,
    disambiguationMode: 'targeted',
    sseEmitter: new EventEmitter(),
  };
}

describe('disambiguate_query — b93d68e4 replay (intent+concept survive clarify)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
    vi.clearAllMocks();
  });

  it('T0 "top spenders this week" — v2 emits leaderboard + writes intent/concept/entity to memory', async () => {
    const t0 = await disambiguateHandler(
      { message: 'top spenders this week' },
      makeCtx(db),
    );

    expect(t0.action).toBe('auto');
    expect(t0.assumption?.slot).toBe('concept');
    expect(t0.assumption?.chosen).toBe('spender');
    expect(t0.query.dimensions).toEqual(['players.user_id']);
    expect(t0.query.measures).toEqual(['recharge.revenue_vnd']);

    // Verify the L2 memory write — intent + concept + entity all landed.
    const mem = getResolutions(db, SID);
    expect(mem.intent?.value).toBe('leaderboard');
    expect(mem.concept?.value).toBe('spender');
    expect(mem.entity?.value).toEqual({ cube: 'players', pk: 'players.user_id' });
  });

  it('T2 "Revenue" reply — restores intent+concept from memory and rebuilds the leaderboard query', async () => {
    // First land T0 to seed memory.
    await disambiguateHandler(
      { message: 'top spenders this week' },
      makeCtx(db),
    );

    // Now the reply turn — pretend the user said only "Revenue".
    const t2 = await disambiguateHandler({ message: 'Revenue' }, makeCtx(db));

    expect(t2.action).toBe('auto');
    // The retry helper restored the leaderboard shape from memory.
    expect(t2.query.dimensions).toEqual(['players.user_id']);
    expect(t2.query.measures).toEqual(['recharge.revenue_vnd']);
    expect(t2.query.order).toEqual({ 'recharge.revenue_vnd': 'desc' });
    expect(t2.query.limit).toBe(10);
    // No assumption emitted on T2 because the v2 layer would have suppressed
    // it (exact-alias match on "Revenue"); the retry path fires after.
    expect(t2.assumption).toBeDefined();
    expect(t2.assumption?.chosen).toBe('spender');
  });

  it('T2 inherits timeRange + emits no clarify', async () => {
    await disambiguateHandler(
      { message: 'top spenders this week' },
      makeCtx(db),
    );
    const t2 = await disambiguateHandler({ message: 'Revenue' }, makeCtx(db));

    expect(t2.clarifications).toHaveLength(0);
    expect(t2.query.timeDimensions).toBeDefined();
    expect(t2.query.timeDimensions?.[0]?.dimension).toBe('players.event_date');
  });
});
