/**
 * Unit tests for resolved-context (P2): the projection of session
 * disambiguation memory into the agent's "Resolved so far" block.
 *
 * Covers empty / partial / full reads, terse rendering, the still-open hint,
 * and the keep-until-rephrase continuity contract (a substantial new question
 * clears topic slots via the SHARED rephrase gate — proving the agent and the
 * engine never disagree about what is resolved).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import { mergeResolution } from '../../src/cache/disambig-memory-adapter.js';
import { fillResultFromMemory } from '../../src/tools/disambiguate-memory-merge.js';
import type { DisambiguationResult } from '../../src/nl-to-query/index.js';
import { readResolvedContext, renderResolvedContext } from '../../src/core/resolved-context.js';
import { config } from '../../src/config.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('readResolvedContext', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
  });

  it('returns an empty context for a session with no memory', () => {
    expect(readResolvedContext(db, 'sess-empty')).toEqual({});
  });

  it('projects a partial memory (metric only)', () => {
    mergeResolution(db, 'sess-1', 'owner', { metric: { value: 'recharge.revenue_vnd', phrase: 'revenue' } });
    const ctx = readResolvedContext(db, 'sess-1');
    expect(ctx.metric).toEqual({ value: 'recharge.revenue_vnd', label: 'revenue' });
    expect(ctx.entity).toBeUndefined();
    expect(ctx.timeRange).toBeUndefined();
  });

  it('projects a full memory (entity + metric + time)', () => {
    mergeResolution(db, 'sess-2', 'owner', {
      entity: { value: { cube: 'mf_users', pk: 'user_id' }, phrase: 'players' },
      metric: { value: 'recharge.revenue_vnd', phrase: 'revenue' },
      timeRange: { value: { dateRange: ['2026-05-01', '2026-05-31'], granularity: 'day' }, phrase: 'last 30 days' },
    });
    const ctx = readResolvedContext(db, 'sess-2');
    expect(ctx.entity?.value).toEqual({ cube: 'mf_users', pk: 'user_id' });
    expect(ctx.entity?.label).toBe('players');
    expect(ctx.metric?.value).toBe('recharge.revenue_vnd');
    expect(ctx.timeRange?.label).toBe('last 30 days');
  });
});

describe('renderResolvedContext', () => {
  it('returns empty string when nothing is resolved', () => {
    expect(renderResolvedContext({})).toBe('');
  });

  it('renders pinned slots with the do-not-re-ask instruction', () => {
    const text = renderResolvedContext({
      entity: { value: { cube: 'mf_users', pk: 'user_id' }, label: 'players' },
      metric: { value: 'recharge.revenue_vnd', label: 'revenue' },
      timeRange: { value: { dateRange: ['2026-05-01', '2026-05-31'] }, label: 'last 30 days' },
    });
    expect(text).toContain('## Resolved so far');
    expect(text).toContain('do NOT re-ask');
    expect(text).toContain('entity = players (mf_users.user_id)');
    expect(text).toContain('metric = revenue');
    expect(text).toContain('time window = last 30 days');
    // All three resolved → no "still open" line.
    expect(text).not.toContain('Still open');
  });

  it('names the still-open slots when only some are resolved', () => {
    const text = renderResolvedContext({
      entity: { value: { cube: 'mf_users', pk: 'user_id' }, label: 'players' },
    });
    expect(text).toContain('entity = players');
    expect(text).toContain('Still open');
    expect(text).toContain('metric');
    expect(text).toContain('time window');
  });

  it('falls back to the cube ref / range when no label phrase is stored', () => {
    const text = renderResolvedContext({
      entity: { value: { cube: 'mf_users', pk: 'user_id' } },
      timeRange: { value: { dateRange: ['2026-05-01', '2026-05-31'] } },
    });
    expect(text).toContain('entity = mf_users (mf_users.user_id)');
    expect(text).toContain('time window = 2026-05-01 to 2026-05-31');
  });
});

describe('continuity — shared rephrase gate keeps slots until a real rephrase', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
  });

  function emptyResult(unresolved: string[]): DisambiguationResult {
    return {
      action: 'auto',
      slots: {
        metric: { value: '', confidence: 0 },
        intent: { value: 'aggregate', confidence: 0.6 },
      },
      clarifications: [],
      warnings: [],
      unresolved,
    } as unknown as DisambiguationResult;
  }

  it('a short slot reply keeps the prior metric (no rephrase) so it stays injected', () => {
    mergeResolution(db, 'sess-c', 'owner', { metric: { value: 'recharge.revenue_vnd', phrase: 'revenue' } });
    // Short reply ("by country") → < 3 unresolved words → topic fill NOT blocked.
    const filled = fillResultFromMemory(emptyResult(['country']), {
      db, sessionId: 'sess-c', ownerId: 'owner', gameId: 'cfm_vn', now: Date.now(),
    });
    expect(filled.slots.metric.value).toBe('recharge.revenue_vnd');
    // And the injected block still shows it.
    expect(renderResolvedContext(readResolvedContext(db, 'sess-c'))).toContain('metric = revenue');
  });

  it('a substantial new question does NOT pull the prior metric (rephrase gate fires)', () => {
    mergeResolution(db, 'sess-d', 'owner', { metric: { value: 'recharge.revenue_vnd', phrase: 'revenue' } });
    // ≥3-word unresolved span → topic fill blocked: the new question is about
    // something the engine couldn't account for, so the old metric must not leak.
    const filled = fillResultFromMemory(emptyResult(['currency outflow reasons by region']), {
      db, sessionId: 'sess-d', ownerId: 'owner', gameId: 'cfm_vn', now: Date.now(),
    });
    expect(filled.slots.metric.value).toBe('');
  });
});
