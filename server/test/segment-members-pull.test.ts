/**
 * GET /api/segments/:id/members — tokenless member pull API.
 *
 * Verifies the ranked member-profile snapshot path (enriched object rows,
 * numeric offset cursor), the uid-only fallback with keyset pagination, the
 * `truncated` signal, and capability-style access (any stored segment id is
 * servable — including cross-workspace rows — while unknown ids 404).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock the Cube loader so the manual-segment on-demand profile path is
// exercisable without a live cluster (everything else uses the DB only).
vi.mock('../src/services/load-with-continue-wait.js', () => ({
  loadWithContinueWait: vi.fn(),
}));

import { loadWithContinueWait } from '../src/services/load-with-continue-wait.js';
import { buildApp } from '../src/index.js';
import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import { __resetManualProfileState } from '../src/services/member-profile-on-demand.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const mockLoad = vi.mocked(loadWithContinueWait);

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

async function createSegment(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/segments',
    payload: { name: 'Pull cohort', type: 'manual' },
  });
  expect(created.statusCode).toBe(201);
  return created.json().id as string;
}

describe('GET /api/segments/:id/members — tokenless member pull', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    __resetManualProfileState();
    mockLoad.mockReset();
    mockLoad.mockRejectedValue(new Error('no cube in tests'));
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('paginates uid fallback via keyset cursor and terminates with next_cursor=null', async () => {
    const id = await createSegment(app);
    // Unsorted on purpose — the route must sort for stable keyset order.
    const uids = ['u3', 'u1', 'u10', 'u2', 'u20'];
    getDb()
      .prepare('UPDATE segments SET uid_list_json = ?, uid_count = ? WHERE id = ?')
      .run(JSON.stringify(uids), uids.length, id);

    const p1 = await app.inject({ method: 'GET', url: `/api/segments/${id}/members?limit=2` });
    expect(p1.statusCode).toBe(200);
    const b1 = p1.json();
    expect(b1.members).toEqual([{ uid: 'u1' }, { uid: 'u10' }]); // lexicographic sort
    expect(b1.total_count).toBe(5);
    expect(b1.returned_count).toBe(2);
    expect(b1.truncated).toBe(false);
    expect(b1.rank_measure).toBeNull();
    expect(b1.next_cursor).toBe('u10');

    const p2 = await app.inject({
      method: 'GET',
      url: `/api/segments/${id}/members?limit=2&cursor=${b1.next_cursor}`,
    });
    const b2 = p2.json();
    expect(b2.members).toEqual([{ uid: 'u2' }, { uid: 'u20' }]);
    expect(b2.next_cursor).toBe('u20');

    const p3 = await app.inject({
      method: 'GET',
      url: `/api/segments/${id}/members?limit=2&cursor=${b2.next_cursor}`,
    });
    const b3 = p3.json();
    expect(b3.members).toEqual([{ uid: 'u3' }]);
    expect(b3.next_cursor).toBeNull(); // exhausted
  });

  it('serves the ranked profile snapshot with enriched rows and offset cursor', async () => {
    const id = await createSegment(app);
    const profiles = {
      computed_at: '2026-06-11T00:00:00.000Z',
      rank_measure: 'mf_users.ltv_total_vnd',
      columns: [
        { key: 'name', label: 'In-game name', field: 'mf_users.ingame_name' },
        { key: 'ltv', label: 'LTV', field: 'mf_users.ltv_total_vnd', format: 'currency' },
        { key: 'joined', label: 'Joined', field: 'mf_users.install_date' },
      ],
      rows: [
        { uid: 'whale1', name: 'Diaochan', ltv: 9000, joined: '2024-01-01' },
        { uid: 'whale2', name: 'Ha Tong', ltv: 5000, joined: '2024-02-01' },
        { uid: 'fish1', name: null, ltv: 100, joined: '2025-03-01' },
      ],
    };
    getDb()
      .prepare(
        'UPDATE segments SET member_profiles_json = ?, uid_list_json = ?, uid_count = ? WHERE id = ?',
      )
      .run(JSON.stringify(profiles), JSON.stringify(['whale1', 'whale2', 'fish1']), 50_000, id);

    const p1 = await app.inject({ method: 'GET', url: `/api/segments/${id}/members?limit=2` });
    expect(p1.statusCode).toBe(200);
    const b1 = p1.json();
    expect(b1.rank_measure).toBe('mf_users.ltv_total_vnd');
    expect(b1.columns.map((c: { key: string }) => c.key)).toEqual(['name', 'ltv', 'joined']);
    expect(b1.members).toEqual([
      { uid: 'whale1', name: 'Diaochan', ltv: 9000, joined: '2024-01-01' },
      { uid: 'whale2', name: 'Ha Tong', ltv: 5000, joined: '2024-02-01' },
    ]); // rank order preserved, NOT lexicographic
    expect(b1.truncated).toBe(true); // 50k cohort, 3-row snapshot
    expect(b1.computed_at).toBe('2026-06-11T00:00:00.000Z');
    expect(b1.next_cursor).toBe('2');

    const p2 = await app.inject({
      method: 'GET',
      url: `/api/segments/${id}/members?limit=2&cursor=${b1.next_cursor}`,
    });
    const b2 = p2.json();
    expect(b2.members).toEqual([{ uid: 'fish1', name: null, ltv: 100, joined: '2025-03-01' }]);
    expect(b2.next_cursor).toBeNull();
  });

  it('falls back to uid rows when the profile snapshot is unreadable or empty', async () => {
    const id = await createSegment(app);
    getDb()
      .prepare('UPDATE segments SET member_profiles_json = ?, uid_list_json = ?, uid_count = ? WHERE id = ?')
      .run('{not json', JSON.stringify(['a', 'b']), 2, id);

    const res = await app.inject({ method: 'GET', url: `/api/segments/${id}/members` });
    expect(res.statusCode).toBe(200);
    expect(res.json().members).toEqual([{ uid: 'a' }, { uid: 'b' }]);
  });

  it('reports truncated=true when uid_count exceeds the stored sample', async () => {
    const id = await createSegment(app);
    const uids = Array.from({ length: 10 }, (_, i) => `id${String(i).padStart(2, '0')}`);
    // True cohort is larger than the materialized (capped) sample.
    getDb()
      .prepare('UPDATE segments SET uid_list_json = ?, uid_count = ? WHERE id = ?')
      .run(JSON.stringify(uids), 500_000, id);

    const res = await app.inject({ method: 'GET', url: `/api/segments/${id}/members?limit=5` });
    const body = res.json();
    expect(body.total_count).toBe(500_000);
    expect(body.returned_count).toBe(5);
    expect(body.truncated).toBe(true);
  });

  it('clamps limit above the max and returns empty page for empty cohort', async () => {
    const id = await createSegment(app);
    // Empty uid list (default '[]').
    const res = await app.inject({ method: 'GET', url: `/api/segments/${id}/members?limit=99999` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.members).toEqual([]);
    expect(body.returned_count).toBe(0);
    expect(body.next_cursor).toBeNull();
  });

  it('dedups duplicate uids so none are skipped across a page boundary', async () => {
    const id = await createSegment(app);
    // 'b' is duplicated and would straddle the page-1/page-2 boundary; the
    // route must dedup so the second 'b' is not silently lost by the keyset.
    const uids = ['a', 'b', 'b', 'c', 'd'];
    getDb()
      .prepare('UPDATE segments SET uid_list_json = ?, uid_count = ? WHERE id = ?')
      .run(JSON.stringify(uids), uids.length, id);

    const collected: string[] = [];
    let cursor: string | null = null;
    // Drain the cohort two at a time.
    for (let i = 0; i < 10; i++) {
      const url = `/api/segments/${id}/members?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await app.inject({ method: 'GET', url });
      const body = res.json();
      collected.push(...body.members.map((m: { uid: string }) => m.uid));
      cursor = body.next_cursor;
      if (!cursor) break;
    }
    expect(collected).toEqual(['a', 'b', 'c', 'd']); // unique set, nothing skipped
  });

  it('clamps a zero/negative/non-numeric limit to a single row', async () => {
    const id = await createSegment(app);
    getDb()
      .prepare('UPDATE segments SET uid_list_json = ?, uid_count = ? WHERE id = ?')
      .run(JSON.stringify(['a', 'b', 'c']), 3, id);

    for (const bad of ['0', '-5', 'abc']) {
      const res = await app.inject({ method: 'GET', url: `/api/segments/${id}/members?limit=${bad}` });
      const body = res.json();
      // '0'/'-5' clamp to 1; 'abc' falls back to the default (≥1) — both yield a non-empty bounded page.
      expect(body.returned_count).toBeGreaterThanOrEqual(1);
      expect(body.members.length).toBe(body.returned_count);
    }
  });

  it('computes profiles on demand for a small manual segment with a hub cube', async () => {
    const id = await createSegment(app);
    // Manual segment keyed on mf_users with a pinned identity mapping — the
    // shape a CS-uploaded uid list takes.
    getDb()
      .prepare("UPDATE segments SET cube = 'mf_users', uid_list_json = ?, uid_count = 2 WHERE id = ?")
      .run(JSON.stringify(['u2', 'u1']), id);
    getDb()
      .prepare("INSERT INTO cube_identity_map (cube, identity_field) VALUES ('mf_users', 'mf_users.user_id')")
      .run();

    mockLoad.mockResolvedValue({
      data: [
        { 'mf_users.user_id': 'u1', 'mf_users.ltv_total_vnd': 900, 'mf_users.ingame_name': 'Diaochan' },
        { 'mf_users.user_id': 'u2', 'mf_users.ltv_total_vnd': 100, 'mf_users.ingame_name': null },
      ],
    });

    const res = await app.inject({ method: 'GET', url: `/api/segments/${id}/members` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rank_measure).toBe('mf_users.ltv_total_vnd');
    expect(body.members[0].uid).toBe('u1'); // ranked, not lexicographic-fallback
    expect(body.members[0].name).toBe('Diaochan');
    expect(body.members[0].ltv).toBe(900);

    // The identity-IN scope carried the uploaded list.
    const sent = mockLoad.mock.calls[0][0] as { filters: Array<{ member: string; values: string[] }> };
    expect(sent.filters[0].member).toBe('mf_users.user_id');
    expect(sent.filters[0].values.sort()).toEqual(['u1', 'u2']);

    // Snapshot persisted — the second pull serves it without another Cube hit.
    mockLoad.mockClear();
    const res2 = await app.inject({ method: 'GET', url: `/api/segments/${id}/members` });
    expect(res2.json().members[0].name).toBe('Diaochan');
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('stays uid-only when the on-demand compute fails (cooldown, no hammering)', async () => {
    const id = await createSegment(app);
    getDb()
      .prepare("UPDATE segments SET cube = 'mf_users', uid_list_json = ?, uid_count = 1 WHERE id = ?")
      .run(JSON.stringify(['solo']), id);
    getDb()
      .prepare("INSERT INTO cube_identity_map (cube, identity_field) VALUES ('mf_users', 'mf_users.user_id')")
      .run();
    // mockLoad already rejects by default.

    const res = await app.inject({ method: 'GET', url: `/api/segments/${id}/members` });
    expect(res.json().members).toEqual([{ uid: 'solo' }]);
    const callsAfterFirst = mockLoad.mock.calls.length;

    // Within the failure cooldown a second pull must not retry Cube.
    await app.inject({ method: 'GET', url: `/api/segments/${id}/members` });
    expect(mockLoad.mock.calls.length).toBe(callsAfterFirst);
  });

  it('serves a segment from a non-default workspace (UUID is the capability)', async () => {
    const id = await createSegment(app);
    getDb()
      .prepare("UPDATE segments SET workspace = 'some-other-ws', uid_list_json = ?, uid_count = 1 WHERE id = ?")
      .run(JSON.stringify(['x']), id);

    const res = await app.inject({ method: 'GET', url: `/api/segments/${id}/members` });
    expect(res.statusCode).toBe(200);
    expect(res.json().members).toEqual([{ uid: 'x' }]);
  });

  it('returns 404 for an unknown segment', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/segments/does-not-exist/members' });
    expect(res.statusCode).toBe(404);
  });
});
