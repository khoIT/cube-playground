import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import * as cubeClient from '../src/services/cube-client.js';
import {
  precomputeSegmentMembers360,
  tieredUids,
  parseTiers,
} from '../src/services/member360-runner.js';
import {
  upsertMember360Cache,
  getMember360Cache,
} from '../src/services/member360-cache-store.js';

// Prefix resolution reads the workspace registry; pin it per-test so the
// physicalization assertions don't depend on local config files.
vi.mock('../src/services/resolve-game-prefix.js', () => ({
  resolveGamePrefix: vi.fn(() => null),
  resolveGamePrefixForWorkspace: vi.fn(() => null),
}));
import { resolveGamePrefixForWorkspace } from '../src/services/resolve-game-prefix.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

const TIERS = {
  computed_at: '2026-06-06T00:00:00.000Z',
  ltv_measure: 'mf_users.ltv_total_vnd',
  tiers: {
    top: [{ uid: 'u1', ltv: 100 }, { uid: 'u2', ltv: 90 }],
    middle: [{ uid: 'u3', ltv: 50 }],
    bottom: [{ uid: 'u4', ltv: 1 }],
  },
};

function seedSegment(id: string, over: { game_id?: string | null; tiers?: unknown } = {}): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO segments (
      id, name, type, owner, status, cube,
      predicate_tree_json, cube_query_json, uid_count, uid_list_json,
      refresh_cadence_min, last_refreshed_at, created_at, updated_at,
      game_id, member_tiers_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, 'm360 runner test', 'predicate', 'tester', 'fresh', 'mf_users',
    '{}', '{"filters":[]}', 4, '["u1","u2","u3","u4"]', 60, null, now, now,
    over.game_id === undefined ? 'ballistar' : over.game_id,
    over.tiers === undefined ? JSON.stringify(TIERS) : (over.tiers as string | null),
  );
}

function lastRunAt(id: string): string | null {
  return (getDb().prepare('SELECT member360_last_run_at AS v FROM segments WHERE id = ?').get(id) as { v: string | null }).v;
}

describe('member360-runner', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    vi.restoreAllMocks();
    vi.mocked(resolveGamePrefixForWorkspace).mockReturnValue(null);
  });
  afterEach(() => closeDb());

  it('fills the cache: tiered uids × core panels, all ok, last_run_at stamped', async () => {
    seedSegment('seg1');
    vi.spyOn(cubeClient, 'load').mockResolvedValue({ data: [{ 'user_profile.country': 'VN' }] });

    const result = await precomputeSegmentMembers360('seg1');
    expect(result).toMatchObject({ uids: 4, panels: 4, error: 0, budgetSkipped: 0 });
    expect(result!.ok).toBe(16); // 4 uids × 4 ballistar core panels

    const u1 = getMember360Cache('seg1', 'u1');
    expect(Object.keys(u1).sort()).toEqual(['activity_timeline', 'profile', 'recharge_timeline', 'transactions']);
    expect(u1.profile.rows).toEqual([{ 'user_profile.country': 'VN' }]);
    expect(lastRunAt('seg1')).not.toBeNull();
  });

  it('scopes each query to the member via panel.identityKey', async () => {
    seedSegment('seg1');
    const load = vi.spyOn(cubeClient, 'load').mockResolvedValue({ data: [] });
    await precomputeSegmentMembers360('seg1');

    const queries = load.mock.calls.map((c) => c[0] as { filters: Array<{ member: string; values: string[] }> });
    expect(queries.length).toBe(16);
    for (const q of queries) {
      // Ballistar core panels all key user_id on their own view.
      expect(q.filters[0].member.endsWith('.user_id')).toBe(true);
      expect(q.filters[0].values.length).toBe(1);
    }
    const uidsQueried = new Set(queries.map((q) => q.filters[0].values[0]));
    expect(uidsQueried).toEqual(new Set(['u1', 'u2', 'u3', 'u4']));
  });

  it('physicalizes queries on prefix workspaces and logicalizes cached rows', async () => {
    seedSegment('seg1');
    vi.mocked(resolveGamePrefixForWorkspace).mockReturnValue('ballistar');
    const load = vi.spyOn(cubeClient, 'load').mockResolvedValue({
      data: [{ 'ballistar_user_profile.country': 'VN' }],
    });

    await precomputeSegmentMembers360('seg1');

    const q = load.mock.calls[0][0] as { filters: Array<{ member: string }>; dimensions: string[] };
    expect(q.filters[0].member.startsWith('ballistar_')).toBe(true);
    expect(q.dimensions.every((d) => d.startsWith('ballistar_'))).toBe(true);
    // Cached rows are logicalized back so the FE reads by logical members.
    expect(getMember360Cache('seg1', 'u1').profile.rows).toEqual([{ 'user_profile.country': 'VN' }]);
  });

  it('persists per-row error status when a panel load fails', async () => {
    seedSegment('seg1');
    vi.spyOn(cubeClient, 'load').mockImplementation(async (query) => {
      const q = query as { dimensions?: string[] };
      if (q.dimensions?.some((d) => d.startsWith('user_transactions.'))) {
        throw new Error('Trino exploded');
      }
      return { data: [{ ok: 1 }] };
    });

    const result = await precomputeSegmentMembers360('seg1');
    expect(result!.error).toBe(4); // transactions panel × 4 uids
    const u1 = getMember360Cache('seg1', 'u1');
    expect(u1.transactions.status).toBe('error');
    expect(u1.transactions.error).toContain('Trino exploded');
    expect(u1.profile.status).toBe('ok');
  });

  it('budget abort persists skips without clobbering prior ok rows, stamps last_run_at', async () => {
    seedSegment('seg1');
    // Pre-warm u1's profile from a prior night.
    upsertMember360Cache('seg1', [
      { uid: 'u1', panelId: 'profile', queryHash: 'old', rows: [{ warm: 1 }], status: 'ok' },
    ]);
    const load = vi.spyOn(cubeClient, 'load').mockResolvedValue({ data: [{ ok: 1 }] });

    const result = await precomputeSegmentMembers360('seg1', 0); // budget already spent
    expect(load).not.toHaveBeenCalled();
    expect(result!.budgetSkipped).toBe(16);
    expect(result!.ok).toBe(0);
    // Prior good row untouched; never-computed cells visible as budget errors.
    const u1 = getMember360Cache('seg1', 'u1');
    expect(u1.profile).toMatchObject({ status: 'ok', rows: [{ warm: 1 }] });
    expect(u1.transactions.status).toBe('error');
    expect(u1.transactions.error).toContain('budget');
    expect(lastRunAt('seg1')).not.toBeNull(); // resumes next window, not next tick
  });

  it('re-run with unchanged data writes nothing (fetched_at stable)', async () => {
    seedSegment('seg1');
    vi.spyOn(cubeClient, 'load').mockResolvedValue({ data: [{ v: 1 }] });
    await precomputeSegmentMembers360('seg1');
    const first = getMember360Cache('seg1', 'u1').profile.fetched_at;
    await new Promise((r) => setTimeout(r, 5));
    await precomputeSegmentMembers360('seg1');
    expect(getMember360Cache('seg1', 'u1').profile.fetched_at).toBe(first);
  });

  it('returns null for ineligible segments (no tiers / unknown game / missing)', async () => {
    seedSegment('no-tiers', { tiers: null });
    seedSegment('no-registry', { game_id: 'muaw' });
    const load = vi.spyOn(cubeClient, 'load').mockResolvedValue({ data: [] });

    expect(await precomputeSegmentMembers360('no-tiers')).toBeNull();
    expect(await precomputeSegmentMembers360('no-registry')).toBeNull();
    expect(await precomputeSegmentMembers360('ghost')).toBeNull();
    expect(load).not.toHaveBeenCalled();
    // Ineligible outcomes still stamp last_run_at so the nightly due-list
    // re-qualifies them next window instead of re-evaluating every tick.
    expect(lastRunAt('no-tiers')).not.toBeNull();
    expect(lastRunAt('no-registry')).not.toBeNull();
  });
});

describe('tier helpers', () => {
  it('tieredUids dedupes across tiers in priority order', () => {
    const uids = tieredUids({
      ...TIERS,
      tiers: { top: [{ uid: 'a', ltv: 2 }], bottom: [{ uid: 'a', ltv: 2 }, { uid: 'b', ltv: 1 }] },
    } as never);
    expect(uids).toEqual(['a', 'b']);
  });

  it('parseTiers rejects corrupt / shapeless json', () => {
    expect(parseTiers(null)).toBeNull();
    expect(parseTiers('{not json')).toBeNull();
    expect(parseTiers('{"computed_at":"x"}')).toBeNull();
    expect(parseTiers(JSON.stringify(TIERS))).not.toBeNull();
  });
});
