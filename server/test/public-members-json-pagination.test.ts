/**
 * Public members endpoint — paginated JSON mode (format=json).
 *
 * Covers the route contract: page-1 + page_id walk, manual segments served from
 * uid_list (no warehouse), reader-error mapping (400/409), scope (401/404), and
 * the regression lock that the tokenless route never exposes the full-cohort
 * page_id reader. The reader's daily warehouse logic is unit-tested separately
 * (segment-page-reader.test.ts); here the daily path is driven through a mocked
 * readPage so the route stays hermetic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../src/index.js';
import { setDb, getDb, closeDb } from '../src/db/sqlite.js';
import { createKey, __resetApiKeyCaches } from '../src/auth/api-key-store.js';
import { __resetRateLimiter } from '../src/services/api-key-rate-limiter.js';
import {
  readPage,
  NoSnapshotError,
  InvalidPageTokenError,
} from '../src/services/segment-page-reader.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mock only readPage; keep the real error classes so the route's instanceof
// branches still match.
vi.mock('../src/services/segment-page-reader.js', async (importActual) => {
  const actual =
    await importActual<typeof import('../src/services/segment-page-reader.js')>();
  return { ...actual, readPage: vi.fn() };
});

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

function insertSegment(over: Record<string, unknown> = {}) {
  const row = {
    id: 'seg-1',
    name: 'Whales',
    type: 'predicate',
    owner: 'admin@vng.com.vn',
    status: 'fresh',
    game_id: 'cfm_vn',
    workspace: 'prod',
    uid_count: 2500,
    uid_list_json: '[]',
    // Pull-path tests need a published contract: only 'served' segments are
    // pullable. Override to 'draft'/'deprecated' to test the not-served gate.
    lifecycle: 'served',
    ...over,
  };
  getDb()
    .prepare(
      `INSERT INTO segments (id, name, type, owner, status, game_id, workspace, uid_count, uid_list_json, lifecycle)
       VALUES (@id, @name, @type, @owner, @status, @game_id, @workspace, @uid_count, @uid_list_json, @lifecycle)`,
    )
    .run(row);
  return row;
}

function authKey() {
  const { plaintext } = createKey({ label: 'k', workspace: 'prod', createdBy: 'admin@vng.com.vn' });
  return { authorization: `Bearer ${plaintext}` };
}

describe('public members — paginated JSON', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    __resetApiKeyCaches();
    __resetRateLimiter();
    vi.mocked(readPage).mockReset();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
    __resetApiKeyCaches();
    __resetRateLimiter();
  });

  it('page 1 returns members + page_id + total_count, has_more=true', async () => {
    insertSegment();
    vi.mocked(readPage).mockResolvedValue({
      uids: ['uid-0001', 'uid-0002'],
      total_count: 2500,
      next_page_id: 'TOKEN_2',
      has_more: true,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1/members?format=json&limit=2',
      headers: authKey(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      segment_id: 'seg-1',
      total_count: 2500,
      returned_count: 2,
      members: ['uid-0001', 'uid-0002'],
      page_id: 'TOKEN_2',
      has_more: true,
    });
  });

  it('following the page_id returns the next slice; final page has_more=false', async () => {
    insertSegment();
    vi.mocked(readPage)
      .mockResolvedValueOnce({
        uids: ['uid-0003'],
        total_count: 2500,
        next_page_id: null,
        has_more: false,
      });
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1/members?format=json&page_id=TOKEN_2',
      headers: authKey(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.members).toEqual(['uid-0003']);
    expect(body.page_id).toBeNull();
    expect(body.has_more).toBe(false);
    // route forwarded the supplied page_id to the reader
    expect(vi.mocked(readPage).mock.calls[0][0]).toMatchObject({ pageId: 'TOKEN_2' });
  });

  it('manual segment is served from uid_list (real reader, no warehouse)', async () => {
    vi.mocked(readPage).mockRestore(); // use the real reader for this one
    const { readPage: realReadPage } =
      await vi.importActual<typeof import('../src/services/segment-page-reader.js')>(
        '../src/services/segment-page-reader.js',
      );
    vi.mocked(readPage).mockImplementation(realReadPage);

    insertSegment({
      id: 'seg-m',
      type: 'manual',
      uid_count: 3,
      uid_list_json: JSON.stringify(['c', 'a', 'b']),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-m/members?format=json',
      headers: authKey(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.members).toEqual(['a', 'b', 'c']); // sorted, full small cohort
    expect(body.has_more).toBe(false);
    expect(body.page_id).toBeNull();
  });

  it('csv_paged returns a CSV body with the next token + counts in headers (page 1)', async () => {
    insertSegment();
    vi.mocked(readPage).mockResolvedValue({
      uids: ['uid-0001', 'uid-0002'],
      total_count: 2500,
      next_page_id: 'TOKEN_2',
      has_more: true,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1/members?format=csv_paged&limit=2',
      headers: authKey(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['x-next-page-id']).toBe('TOKEN_2');
    expect(res.headers['x-has-more']).toBe('true');
    expect(res.headers['x-total-count']).toBe('2500');
    expect(res.headers['x-returned-count']).toBe('2');
    // page 1 carries the uid header row
    expect(res.body).toBe('uid\nuid-0001\nuid-0002\n');
  });

  it('csv_paged omits the header row + X-Next-Page-Id on the final page', async () => {
    insertSegment();
    vi.mocked(readPage).mockResolvedValue({
      uids: ['uid-0003'],
      total_count: 2500,
      next_page_id: null,
      has_more: false,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1/members?format=csv_paged&page_id=TOKEN_2',
      headers: authKey(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-next-page-id']).toBeUndefined(); // no more pages
    expect(res.headers['x-has-more']).toBe('false');
    expect(res.body).toBe('uid-0003\n'); // no header row on a follow-up page
    expect(vi.mocked(readPage).mock.calls[0][0]).toMatchObject({ pageId: 'TOKEN_2' });
  });

  it('csv_paged maps a no-snapshot predicate to 409', async () => {
    insertSegment();
    vi.mocked(readPage).mockRejectedValue(new NoSnapshotError('seg-1'));
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1/members?format=csv_paged',
      headers: authKey(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_SNAPSHOT');
  });

  it('409 when a predicate segment has no snapshot', async () => {
    insertSegment();
    vi.mocked(readPage).mockRejectedValue(new NoSnapshotError('seg-1'));
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1/members?format=json',
      headers: authKey(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_SNAPSHOT');
  });

  it('400 on a bad page_id', async () => {
    insertSegment();
    vi.mocked(readPage).mockRejectedValue(new InvalidPageTokenError('page_id is not a valid token'));
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1/members?format=json&page_id=garbage',
      headers: authKey(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_PAGE_ID');
  });

  it('401 without a key', async () => {
    insertSegment();
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1/members?format=json',
    });
    expect(res.statusCode).toBe(401);
  });

  it('404 for an out-of-scope segment (no existence leak), never 403', async () => {
    insertSegment({ id: 'seg-1', workspace: 'local' }); // different workspace
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1/members?format=json',
      headers: authKey(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('tokenless route never exposes page_id / the full-cohort reader (lock)', async () => {
    // The full-cohort daily reader is wired ONLY onto /api/public/v1. The
    // tokenless /api/segments/:id/members must stay on its legacy capped shape
    // (next_cursor + truncated), never the new page_id pagination.
    insertSegment({
      id: 'seg-tk',
      type: 'manual',
      uid_count: 2,
      uid_list_json: JSON.stringify(['a', 'b']),
    });
    const res = await app.inject({ method: 'GET', url: '/api/segments/seg-tk/members' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.page_id).toBeUndefined(); // never the new pagination token
    expect(body).toHaveProperty('next_cursor'); // legacy keyset cursor shape
    expect(body).toHaveProperty('truncated');
    expect(vi.mocked(readPage)).not.toHaveBeenCalled(); // tokenless never hits the reader
  });

  it('default format stays ndjson (json mode is opt-in)', async () => {
    insertSegment({ type: 'manual', uid_list_json: '[]' });
    // No format → ndjson stream path → 422 NO_SOURCE for a manual seg w/ no
    // partition (unchanged legacy behavior, proves json mode did not hijack it).
    const res = await app.inject({
      method: 'GET',
      url: '/api/public/v1/segments/seg-1/members',
      headers: authKey(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('NO_SOURCE');
    expect(vi.mocked(readPage)).not.toHaveBeenCalled();
  });
});
