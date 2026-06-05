import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mock the Cube loader so runPresetCards is exercised without a live cluster.
vi.mock('../src/services/load-with-continue-wait.js', () => ({
  loadWithContinueWait: vi.fn(),
}));

import { loadWithContinueWait } from '../src/services/load-with-continue-wait.js';
import { runPresetCards } from '../src/services/card-runner.js';
import type { PresetSpec } from '../src/presets/mf-users-hub.js';
import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import { upsertCardCache, getCardCache } from '../src/services/card-cache-store.js';

const mockLoad = vi.mocked(loadWithContinueWait);

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

/** Preset with `cardCount` bar cards under one tab + one headline KPI. */
function makePreset(cardCount: number): PresetSpec {
  return {
    id: 'test-hub',
    hubCube: 'mf_users',
    identityDim: 'mf_users.user_id',
    headlineKpis: [{ id: 'size', label: 'Size', measure: 'mf_users.user_count' }],
    tabs: [
      {
        id: 'overview',
        label: 'Overview',
        kpis: [],
        cards: Array.from({ length: cardCount }, (_, i) => ({
          kind: 'bar' as const,
          id: `c${i}`,
          label: `Card ${i}`,
          measure: 'mf_users.user_count',
          groupBy: 'mf_users.country',
        })),
      },
    ],
  };
}

describe('runPresetCards — concurrency, error entries, budget', () => {
  beforeEach(() => {
    mockLoad.mockReset();
  });

  it('computes every card and marks them ok on the happy path', async () => {
    mockLoad.mockResolvedValue({ data: [{ 'mf_users.country': 'VN', 'mf_users.user_count': 10 }] } as never);
    const entries = await runPresetCards(makePreset(3), []);
    // 1 headline KPI + 3 cards
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.status === 'ok')).toBe(true);
    const ids = entries.map((e) => e.cardId).sort();
    expect(ids).toContain('kpi:size');
    expect(ids).toContain('card:overview:c0');
  });

  it('persists an error entry (not a silent gap) when a card load fails', async () => {
    mockLoad.mockImplementation(async (q: unknown) => {
      // Fail the bar card, succeed the headline KPI.
      const query = q as { dimensions?: string[] };
      if (query.dimensions?.includes('mf_users.country')) {
        throw new Error('Cube /load: query text length exceeds the maximum');
      }
      return { data: [{ 'mf_users.user_count': 5 }] } as never;
    });

    const entries = await runPresetCards(makePreset(1), []);
    const kpi = entries.find((e) => e.cardId === 'kpi:size');
    const card = entries.find((e) => e.cardId === 'card:overview:c0');
    expect(kpi?.status).toBe('ok');
    expect(card?.status).toBe('error');
    expect(card?.error).toContain('query text length');
    expect(card?.rows).toEqual([]);
  });

  it('never runs more than the concurrency cap (4) at once', async () => {
    let active = 0;
    let maxActive = 0;
    mockLoad.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { data: [] } as never;
    });

    await runPresetCards(makePreset(12), []); // 13 specs total
    expect(maxActive).toBeGreaterThan(1); // genuinely parallel
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it('short-circuits remaining cards to error once the phase budget is spent', async () => {
    // Freeze the clock so the budget is already exhausted on the first remaining-
    // time check: deadline = base + 90s, then "now" jumps past it.
    const base = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(base); // deadline computed once at pass start
    nowSpy.mockReturnValue(base + 90_001); // every per-card remaining check → ≤ 0
    mockLoad.mockResolvedValue({ data: [] } as never);

    const entries = await runPresetCards(makePreset(2), []);
    expect(entries.every((e) => e.status === 'error')).toBe(true);
    expect(entries.every((e) => e.error?.includes('budget'))).toBe(true);
    expect(mockLoad).not.toHaveBeenCalled(); // no Cube load issued past the budget
    nowSpy.mockRestore();
  });
});

describe('card-cache-store — status/error round-trip', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    }
    // A segment row is required for the FK.
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO segments (id, name, type, owner, status, uid_count, uid_list_json, created_at, updated_at) VALUES ('s1','seg','predicate','t','fresh',0,'[]',?,?)",
    ).run(now, now);
    setDb(db);
  });

  afterEach(() => closeDb());

  it('writes and reads back per-card status + error, and flips ok↔error', () => {
    upsertCardCache('s1', [
      { cardId: 'kpi:size', queryHash: 'h1', rows: [{ v: 1 }], status: 'ok' },
      { cardId: 'card:overview:c0', queryHash: 'h2', rows: [], status: 'error', error: 'boom' },
    ]);

    let cache = getCardCache('s1');
    expect(cache['kpi:size'].status).toBe('ok');
    expect(cache['kpi:size'].error).toBeUndefined();
    expect(cache['card:overview:c0'].status).toBe('error');
    expect(cache['card:overview:c0'].error).toBe('boom');

    // A later successful refresh clears the error.
    upsertCardCache('s1', [
      { cardId: 'card:overview:c0', queryHash: 'h3', rows: [{ v: 2 }], status: 'ok' },
    ]);
    cache = getCardCache('s1');
    expect(cache['card:overview:c0'].status).toBe('ok');
    expect(cache['card:overview:c0'].error).toBeUndefined();
    expect(cache['card:overview:c0'].rows).toEqual([{ v: 2 }]);
  });
});
