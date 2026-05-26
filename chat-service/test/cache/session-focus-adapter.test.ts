/**
 * Phase 02 unit tests for session-focus-adapter — getFocus / mergeFocus /
 * clearFocus + renderFocusPreamble + the flag gate behaviour.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import {
  getFocus,
  mergeFocus,
  clearFocus,
  renderFocusPreamble,
  type SessionFocus,
} from '../../src/cache/session-focus-adapter.js';
import { config } from '../../src/config.js';

const SID = 'sess-focus';
const OWNER = 'owner-a';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

beforeEach(() => {
  (config as { cacheServiceEnabled: boolean; chatContextFocusStoreEnabled: boolean })
    .cacheServiceEnabled = true;
  (config as { cacheServiceEnabled: boolean; chatContextFocusStoreEnabled: boolean })
    .chatContextFocusStoreEnabled = true;
});

describe('session-focus-adapter — CRUD + merge semantics', () => {
  it('getFocus returns empty on miss', () => {
    const db = makeDb();
    expect(getFocus(db, SID)).toEqual({});
  });

  it('mergeFocus writes; getFocus reads back', () => {
    const db = makeDb();
    mergeFocus(db, SID, OWNER, {
      metric: { value: 'recharge.revenue_vnd', phrase: 'revenue' },
      timeRange: {
        value: { dateRange: 'last 7 days', granularity: 'day' },
        phrase: 'last 7 days',
      },
    });
    const f = getFocus(db, SID);
    expect(f.metric?.value).toBe('recharge.revenue_vnd');
    expect(f.metric?.phrase).toBe('revenue');
    expect(f.timeRange?.value.dateRange).toBe('last 7 days');
    expect(f.updatedAt).toBeDefined();
  });

  it('mergeFocus accumulates across calls', () => {
    const db = makeDb();
    mergeFocus(db, SID, OWNER, { metric: { value: 'recharge.revenue_vnd' } });
    mergeFocus(db, SID, OWNER, { dimension: { value: 'players.country' } });
    const f = getFocus(db, SID);
    expect(f.metric?.value).toBe('recharge.revenue_vnd');
    expect(f.dimension?.value).toBe('players.country');
  });

  it('mergeFocus overwrites a key on topic pivot (R1 stale focus)', () => {
    const db = makeDb();
    mergeFocus(db, SID, OWNER, { metric: { value: 'old.metric' } });
    mergeFocus(db, SID, OWNER, { metric: { value: 'new.metric' } });
    expect(getFocus(db, SID).metric?.value).toBe('new.metric');
  });

  it('mergeFocus merges filter map without dropping prior entries', () => {
    const db = makeDb();
    mergeFocus(db, SID, OWNER, { filters: { 'players.country': { value: 'VN' } } });
    mergeFocus(db, SID, OWNER, { filters: { 'players.platform': { value: 'iOS' } } });
    const f = getFocus(db, SID);
    expect(f.filters?.['players.country']?.value).toBe('VN');
    expect(f.filters?.['players.platform']?.value).toBe('iOS');
  });

  it('clearFocus drops the row', () => {
    const db = makeDb();
    mergeFocus(db, SID, OWNER, { metric: { value: 'm' } });
    expect(getFocus(db, SID).metric).toBeDefined();
    clearFocus(db, SID);
    expect(getFocus(db, SID)).toEqual({});
  });
});

describe('session-focus-adapter — flag gates', () => {
  it('mergeFocus no-ops when flag off; getFocus returns empty', () => {
    const db = makeDb();
    (config as { chatContextFocusStoreEnabled: boolean }).chatContextFocusStoreEnabled = false;
    mergeFocus(db, SID, OWNER, { metric: { value: 'r' } });
    expect(getFocus(db, SID)).toEqual({});
  });

  it('getFocus returns empty when cache service is off', () => {
    const db = makeDb();
    mergeFocus(db, SID, OWNER, { metric: { value: 'r' } });
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = false;
    expect(getFocus(db, SID)).toEqual({});
  });
});

describe('renderFocusPreamble', () => {
  it('returns empty when bag has no usable slots', () => {
    expect(renderFocusPreamble({})).toBe('');
    expect(renderFocusPreamble({ updatedAt: 1 })).toBe('');
  });

  it('renders metric + timeRange + filter as a `## Conversation focus` block', () => {
    const focus: SessionFocus = {
      metric: { value: 'recharge.revenue_vnd', phrase: 'doanh thu' },
      timeRange: {
        value: { dateRange: ['2026-05-19', '2026-05-26'], granularity: 'day' },
        phrase: 'last 7 days',
      },
      filters: { 'players.country': { value: 'VN', phrase: 'Vietnam' } },
      artifactRef: { value: 'artifact:abc' },
    };
    const out = renderFocusPreamble(focus);
    expect(out).toContain('## Conversation focus');
    expect(out).toContain('{{field:recharge.revenue_vnd}}');
    expect(out).toContain('last 7 days');
    expect(out).toContain('2026-05-19..2026-05-26');
    expect(out).toContain('players.country = VN');
    expect(out).toContain('artifact:abc');
  });

  it('caps filters at 5 (R2 token bloat)', () => {
    const focus: SessionFocus = {
      metric: { value: 'm' },
      filters: Object.fromEntries(
        Array.from({ length: 7 }, (_, i) => [`f${i}`, { value: `v${i}` } as const]),
      ),
    };
    const out = renderFocusPreamble(focus);
    const filterLines = out.split('\n').filter((l) => l.startsWith('- Filter:'));
    expect(filterLines.length).toBe(5);
  });
});
