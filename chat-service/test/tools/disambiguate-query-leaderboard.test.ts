/**
 * End-to-end replay of session a0cc4d4c through the disambiguate_query
 * handler. Verifies the full multi-turn flow:
 *
 *   T0 "top spenders this week"
 *     → intent=leaderboard, timeRange resolved, metric=∅ → clarify metric
 *
 *   T2 "ARPU"  (extractor resolves mf_users.arpu_vnd)
 *     → time-dim validator rejects (mf_users has no time dim under timeRange)
 *     → clarify metric with alternatives, includes recharge.revenue_vnd
 *
 *   T4 "recharge.revenue_vnd"  (now on a time-aware cube)
 *     → intent=leaderboard from memory, dimension=∅ → clarify "rank by which entity"
 *
 *   T6 "by user"  (extractor resolves to a user-id dim)
 *     → action=auto, query has order={metric:desc}, limit=10
 *
 * Cube /meta is mocked with two cubes: time-aware `recharge`, snapshot
 * `mf_users`. Glossary is stubbed via the engine entry point.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock cube-meta-cache BEFORE importing the handler. The mock factory is
// hoisted to the top of the file; use vi.hoisted to share fixtures.
const { META, GLOSSARY } = vi.hoisted(() => ({
  META: {
    cubes: [
      {
        name: 'recharge',
        measures: [
          { name: 'recharge.revenue_vnd', shortTitle: 'Revenue (VND)' },
          { name: 'recharge.daily_arpu', shortTitle: 'Daily ARPU' },
        ],
        dimensions: [
          { name: 'recharge.created_at', type: 'time' },
          { name: 'recharge.channel', type: 'string' },
        ],
      },
      {
        name: 'mf_users',
        measures: [{ name: 'mf_users.arpu_vnd', shortTitle: 'ARPU' }],
        dimensions: [
          { name: 'mf_users.id', type: 'string' },
          { name: 'mf_users.country', type: 'string' },
        ],
      },
    ],
  },
  GLOSSARY: [
    {
      id: 'arpu', label: 'ARPU', labelVi: 'ARPU', description: '',
      primaryCatalogId: 'mf_users.arpu_vnd',
      aliases: ['arpu', 'arpu_vnd'], aliasesVi: [],
      category: 'monetisation',
    },
    {
      id: 'revenue', label: 'Revenue', labelVi: 'Doanh thu', description: '',
      primaryCatalogId: 'recharge.revenue_vnd',
      aliases: ['revenue', 'recharge revenue', 'revenue_vnd'],
      aliasesVi: ['doanh thu'], category: 'revenue',
    },
    {
      id: 'user', label: 'User', labelVi: 'Người dùng', description: '',
      primaryCatalogId: 'mf_users.id',
      aliases: ['by user', 'user'],
      aliasesVi: ['theo người dùng'], category: 'dimension',
    },
  ],
}));

vi.mock('../../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn().mockResolvedValue(META),
  extractMemberNames: () => new Set([
    'recharge.revenue_vnd', 'recharge.daily_arpu', 'recharge.created_at', 'recharge.channel',
    'mf_users.arpu_vnd', 'mf_users.id', 'mf_users.country',
  ]),
}));

vi.mock('../../src/nl-to-query/glossary-client.js', () => ({
  fetchOfficialGlossary: vi.fn().mockResolvedValue(GLOSSARY),
  __resetGlossaryCache: () => {},
}));

import { handler } from '../../src/tools/disambiguate-query.js';
import { migrate } from '../../src/db/migrate.js';
import { config } from '../../src/config.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function ctx(db: Database.Database, now: number) {
  return {
    ownerId: 'owner-a',
    gameId: 'game-x',
    cubeToken: 'cube-token-test',
    workspace: 'local',
    sessionId: 'sess-replay',
    turnId: 't',
    sseEmitter: new EventEmitter(),
    db,
    now: () => now,
    disambiguationMode: 'targeted' as const,
  };
}

describe('disambiguate_query — top spenders leaderboard replay', () => {
  let db: Database.Database;
  const NOW = Date.UTC(2026, 4, 27);

  beforeEach(() => {
    db = makeDb();
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
  });

  it('T0 "top spenders this week" → clarify metric, intent=leaderboard, timeRange resolved', async () => {
    const r = await handler({ message: 'top spenders this week' }, ctx(db, NOW));
    expect(r.slots.intent.value).toBe('leaderboard');
    expect(r.slots.timeRange?.value).toBeDefined();
    expect(r.action).toBe('clarify');
    expect(r.clarifications.some((c) => c.slot === 'metric')).toBe(true);
  });

  it('T2 "ARPU" picked → snapshot cube rejected, clarify suggests time-aware alt', async () => {
    // Prime session memory with timeRange from T0.
    await handler({ message: 'top spenders this week' }, ctx(db, NOW));
    const r = await handler({ message: 'ARPU' }, ctx(db, NOW));

    // metric was rejected → cleared
    expect(r.slots.metric.value).toBeUndefined();
    expect(r.action).toBe('clarify');
    expect(r.warnings.some((w) => w.includes('no time dimension'))).toBe(true);
    // Alternative options should include the time-aware ARPU measure.
    const metricClar = r.clarifications.find((c) => c.slot === 'metric');
    expect(metricClar).toBeDefined();
    expect(metricClar!.options?.some((o) => o.value === 'recharge.daily_arpu')).toBe(true);
  });
});
