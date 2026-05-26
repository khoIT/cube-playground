import { describe, it, expect } from 'vitest';
import { buildLeaderboardQuery } from '../../src/nl-to-query/leaderboard-path.js';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';

function term(overrides: Partial<OfficialTerm>): OfficialTerm {
  return {
    id: overrides.id ?? 'x',
    label: overrides.label ?? 'X',
    description: '',
    primaryCatalogId: null,
    aliases: [],
    aliasesVi: [],
    labelVi: null,
    category: null,
    entityCube: overrides.entityCube ?? null,
    entityPk: overrides.entityPk ?? null,
    defaultMeasureRef: overrides.defaultMeasureRef ?? null,
    defaultFilter: overrides.defaultFilter ?? null,
    ranking: overrides.ranking ?? null,
    trustTier: null,
  };
}

const SPENDER = term({
  id: 'spender',
  entityCube: 'players',
  entityPk: 'players.user_id',
  defaultMeasureRef: 'recharge.revenue_vnd',
  defaultFilter: { member: 'recharge.revenue_vnd', op: '>', value: 0 },
  ranking: { order: 'DESC', default_limit: 10 },
});

describe('buildLeaderboardQuery — happy path', () => {
  it('builds {measures, dimensions, filters, order, limit} from a rankable concept', () => {
    const r = buildLeaderboardQuery({ concept: SPENDER });
    expect(r.rankable).toBe(true);
    expect(r.query).toMatchObject({
      measures: ['recharge.revenue_vnd'],
      dimensions: ['players.user_id'],
      order: { 'recharge.revenue_vnd': 'desc' },
      limit: 10,
    });
    expect(r.query.filters).toEqual([
      { member: 'recharge.revenue_vnd', operator: 'gt', values: ['0'] },
    ]);
  });

  it('applies user-supplied "top N" over default_limit', () => {
    const r = buildLeaderboardQuery({ concept: SPENDER, limit: 5 });
    expect(r.query.limit).toBe(5);
  });

  it('adds timeDimensions from input timeRange (default dimension)', () => {
    const r = buildLeaderboardQuery({
      concept: SPENDER,
      timeRange: { dateRange: 'this week' },
    });
    expect(r.query.timeDimensions).toEqual([
      { dimension: 'players.event_date', dateRange: 'this week' },
    ]);
  });

  it('uses caller-supplied time dimension override', () => {
    const r = buildLeaderboardQuery({
      concept: SPENDER,
      timeRange: { dateRange: 'last 30 days', dimension: 'recharge.event_date', granularity: 'day' },
    });
    expect(r.query.timeDimensions).toEqual([
      {
        dimension: 'recharge.event_date',
        dateRange: 'last 30 days',
        granularity: 'day',
      },
    ]);
  });

  it('maps ASC order correctly', () => {
    const asc = term({
      id: 'cheapest-spender',
      entityCube: 'players',
      entityPk: 'players.user_id',
      defaultMeasureRef: 'recharge.revenue_vnd',
      ranking: { order: 'ASC', default_limit: 3 },
    });
    const r = buildLeaderboardQuery({ concept: asc });
    expect(r.query.order).toEqual({ 'recharge.revenue_vnd': 'asc' });
  });

  it('omits filters when concept has no defaultFilter', () => {
    const noFilter = term({
      id: 'new-spender',
      entityCube: 'players',
      entityPk: 'players.user_id',
      defaultMeasureRef: 'recharge.revenue_vnd',
      ranking: { order: 'DESC', default_limit: 10 },
    });
    const r = buildLeaderboardQuery({ concept: noFilter });
    expect(r.query.filters).toBeUndefined();
  });

  it('translates IN op into Cube equals with multi-value', () => {
    const inFilter = term({
      id: 'tier-spender',
      entityCube: 'players',
      entityPk: 'players.user_id',
      defaultMeasureRef: 'recharge.revenue_vnd',
      defaultFilter: { member: 'players.tier', op: 'IN', value: ['whale', 'dolphin'] },
      ranking: { order: 'DESC', default_limit: 10 },
    });
    const r = buildLeaderboardQuery({ concept: inFilter });
    expect(r.query.filters).toEqual([
      { member: 'players.tier', operator: 'equals', values: ['whale', 'dolphin'] },
    ]);
  });
});

describe('buildLeaderboardQuery — fallthrough', () => {
  it('flags non-rankable concept (no ranking config)', () => {
    const churner = term({
      id: 'churner',
      entityCube: 'players',
      entityPk: 'players.user_id',
    });
    const r = buildLeaderboardQuery({ concept: churner });
    expect(r.rankable).toBe(false);
    expect(r.reason).toMatch(/ranking/);
  });

  it('flags concept missing entity (dimension concept like "top-country")', () => {
    const topCountry = term({
      id: 'top-country',
      ranking: { order: 'DESC', default_limit: 10 },
    });
    const r = buildLeaderboardQuery({ concept: topCountry });
    expect(r.rankable).toBe(false);
    expect(r.reason).toMatch(/entity/);
  });

  it('flags concept missing default measure', () => {
    const noMeasure = term({
      id: 'mystery',
      entityCube: 'players',
      entityPk: 'players.user_id',
      ranking: { order: 'DESC', default_limit: 10 },
    });
    const r = buildLeaderboardQuery({ concept: noMeasure });
    expect(r.rankable).toBe(false);
    expect(r.reason).toMatch(/measure/);
  });
});
