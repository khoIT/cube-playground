/**
 * Phase 02a — disambiguate_query handler with CHAT_GLOSSARY_V2 on.
 *
 * Confirms the three short-circuits land:
 *   - fully-qualified cube ref → auto, no assumption
 *   - exact alias match → auto, no assumption
 *   - rankable concept + leaderboard intent → auto, leaderboard query, assumption
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
    chatGlossaryV2Enabled: true,
    chatGlossaryAutorouteThreshold: 0.8,
  },
  isLangfuseEnabled: () => false,
}));

import { handler as disambiguateHandler } from '../../src/tools/disambiguate-query.js';
import { migrate } from '../../src/db/migrate.js';
import type { ToolContext } from '../../src/types.js';

function makeCtx(): ToolContext {
  const db = new Database(':memory:');
  migrate(db);
  return {
    ownerId: 'o1',
    gameId: 'ptg',
    cubeToken: 'tok',
    sessionId: 's1',
    turnId: 't1',
    db,
    disambiguationMode: 'targeted',
    sseEmitter: new EventEmitter(),
  };
}

describe('disambiguate_query — glossary v2 short-circuits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fully-qualified cube ref auto-routes with confidence 1.0, no assumption', async () => {
    const out = await disambiguateHandler(
      { message: 'recharge.revenue_vnd' },
      makeCtx(),
    );
    expect(out.action).toBe('auto');
    expect(out.slots.metric.value).toBe('recharge.revenue_vnd');
    expect(out.slots.metric.confidence).toBe(1.0);
    expect(out.assumption).toBeUndefined();
    expect(out.clarifications).toHaveLength(0);
  });

  it('exact alias verbatim auto-routes, no assumption', async () => {
    const out = await disambiguateHandler(
      { message: 'spenders' },
      makeCtx(),
    );
    expect(out.action).toBe('auto');
    expect(out.assumption).toBeUndefined();
    expect(out.clarifications).toHaveLength(0);
  });

  it('rankable concept + leaderboard intent auto-routes with assumption + leaderboard query', async () => {
    const out = await disambiguateHandler(
      { message: 'top spenders this week' },
      makeCtx(),
    );
    expect(out.action).toBe('auto');
    expect(out.assumption).toBeDefined();
    expect(out.assumption?.slot).toBe('concept');
    expect(out.assumption?.chosen).toBe('spender');
    expect(out.assumption?.confidence).toBe(0.85);

    // Query should be entity-ranked by recharge.revenue_vnd DESC, grouped by user_id.
    expect(out.query.measures).toEqual(['recharge.revenue_vnd']);
    expect(out.query.dimensions).toEqual(['players.user_id']);
    expect(out.query.order).toEqual({ 'recharge.revenue_vnd': 'desc' });
    expect(out.query.limit).toBe(10);
    expect(out.query.filters).toEqual([
      { member: 'recharge.revenue_vnd', operator: 'gt', values: ['0'] },
    ]);
    // timeDimensions inherited from engine's timeRange slot.
    expect(out.query.timeDimensions).toBeDefined();
    expect(out.query.timeDimensions?.[0]?.dimension).toBe('players.event_date');
  });
});
