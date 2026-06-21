/**
 * Replay of session 224c54e8 — the assistant suggested
 * `{{field:etl_money_flow.total_out}}` in prose, then the next turn's
 * "Show diamond inflow vs outflow by money type using etl_money_flow …"
 * collapsed to a canned, cross-cube clarify menu (Revenue/ARPU/LTV) with a
 * stale gacha dimension (`etl_lottery_shoot.lottery_id`).
 *
 * The fix anchors resolution to a cube the message NAMES (A) or the assistant
 * SUGGESTED (B): the dimension binds to `etl_money_flow.money_type`, the metric
 * clarify options become the cube's own in/out measures, and a stale cross-cube
 * dimension carried from a prior turn is dropped.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const { META, GLOSSARY, MEMBER_NAMES } = vi.hoisted(() => {
  const META = {
    cubes: [
      {
        name: 'etl_money_flow',
        measures: [
          { name: 'etl_money_flow.events' },
          { name: 'etl_money_flow.distinct_players' },
          { name: 'etl_money_flow.total_in', shortTitle: 'Total In' },
          { name: 'etl_money_flow.total_out', shortTitle: 'Total Out' },
          { name: 'etl_money_flow.total_delta' },
          { name: 'etl_money_flow.in_events' },
          { name: 'etl_money_flow.out_events' },
        ],
        dimensions: [
          { name: 'etl_money_flow.money_type', type: 'string' },
          { name: 'etl_money_flow.direction', type: 'string' },
          { name: 'etl_money_flow.log_date', type: 'time' },
        ],
      },
      {
        name: 'etl_lottery_shoot',
        measures: [{ name: 'etl_lottery_shoot.draws' }],
        dimensions: [{ name: 'etl_lottery_shoot.lottery_id', type: 'string' }],
      },
      {
        name: 'recharge',
        measures: [{ name: 'recharge.revenue_vnd', shortTitle: 'Revenue (VND)' }],
        dimensions: [{ name: 'recharge.event_date', type: 'time' }],
      },
    ],
  };
  const MEMBER_NAMES = new Set<string>();
  for (const c of META.cubes) {
    for (const m of c.measures) MEMBER_NAMES.add(m.name);
    for (const d of c.dimensions) MEMBER_NAMES.add(d.name);
  }
  const GLOSSARY = [
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
  ];
  return { META, GLOSSARY, MEMBER_NAMES };
});

vi.mock('../../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(async () => META),
  extractMemberNames: () => MEMBER_NAMES,
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
import { mergeResolution } from '../../src/cache/disambig-memory-adapter.js';
import type { ToolContext } from '../../src/types.js';

const OWNER = 'pm-vng';
const GAME = 'cfm_vn';
const SID = 'sess-224c54e8-replay';

function makeCtx(db: Database.Database): ToolContext {
  return {
    ownerId: OWNER,
    gameId: GAME,
    cubeToken: 'tok',
    workspace: 'local',
    sessionId: SID,
    turnId: 't',
    db,
    disambiguationMode: 'targeted',
    sseEmitter: new EventEmitter(),
  };
}

const NAMED_CUBE_MSG =
  'Show diamond inflow vs outflow by money type using etl_money_flow — ' +
  'are players earning more than they spend in the most recent month?';

describe('disambiguate_query — 224c54e8 replay (cube-anchored resolution)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
    vi.clearAllMocks();
  });

  it('A — message names etl_money_flow: binds money_type + offers the cube in/out measures', async () => {
    const r = await disambiguateHandler({ message: NAMED_CUBE_MSG }, makeCtx(db));

    // An in-vs-out comparison can't auto-route through a single metric slot,
    // so it stays a clarify — but a SCOPED one.
    expect(r.action).toBe('clarify');
    expect(r.slots.dimension?.value).toBe('etl_money_flow.money_type');

    const metricClar = r.clarifications.find((c) => c.slot === 'metric');
    const opts = (metricClar?.options ?? []).map((o) => o.value);
    expect(opts).toContain('etl_money_flow.total_in');
    expect(opts).toContain('etl_money_flow.total_out');
    // Never the canned cross-cube fallback.
    expect(opts).not.toContain('etl_lottery_shoot.lottery_id');
    expect(r.warnings.join(' ')).toContain('anchored to cube etl_money_flow');
  });

  it('A — drops a stale cross-cube dimension carried from a prior gacha turn', async () => {
    // Prior turn pinned a lottery dimension into session memory.
    mergeResolution(db, SID, OWNER, { dimension: { value: 'etl_lottery_shoot.lottery_id' } });

    const r = await disambiguateHandler(
      { message: 'show me etl_money_flow for the most recent month' },
      makeCtx(db),
    );

    expect(r.slots.dimension?.value).not.toBe('etl_lottery_shoot.lottery_id');
    expect(r.warnings.join(' ')).toContain('not on anchor cube etl_money_flow');
  });

  it('B — anchors to a cube the assistant suggested via {{field:}} when the message names none', async () => {
    // Simulate the prior prose-only suggestion (turn 3) persisting the cube.
    mergeResolution(db, SID, OWNER, {
      suggestedCube: { value: 'etl_money_flow', phrase: 'etl_money_flow.total_out' },
    });

    const r = await disambiguateHandler(
      { message: 'show inflow vs outflow by money type' },
      makeCtx(db),
    );

    expect(r.slots.dimension?.value).toBe('etl_money_flow.money_type');
    const opts = (r.clarifications.find((c) => c.slot === 'metric')?.options ?? []).map((o) => o.value);
    expect(opts).toContain('etl_money_flow.total_out');
    expect(r.warnings.join(' ')).toContain('assistant-suggested field');
  });

  it('A — a bare cube name (no genuine measure match) never AUTO-executes — stays a scoped clarify', async () => {
    // "recharge" names a cube but no measure phrase clears the autoroute floor;
    // the cube's measures are offered (0.5), never auto-pinned (< 0.8).
    const r = await disambiguateHandler({ message: 'show me recharge' }, makeCtx(db));

    expect(r.action).toBe('clarify');
    expect(r.slots.metric?.value).toBeFalsy();
  });

  it('B — does NOT hijack a resolvable new question even with a suggested cube in memory', async () => {
    mergeResolution(db, SID, OWNER, {
      suggestedCube: { value: 'etl_money_flow', phrase: 'etl_money_flow.total_out' },
    });

    const r = await disambiguateHandler({ message: 'revenue' }, makeCtx(db));

    expect(r.slots.metric?.value).toBe('recharge.revenue_vnd');
    expect(r.warnings.join(' ')).not.toContain('anchored to cube etl_money_flow');
  });
});
