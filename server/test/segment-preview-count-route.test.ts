/**
 * Route tests for POST /api/segments/preview-count — the dry-run cohort size
 * the chat propose card calls before a segment is saved. computeSegmentSize is
 * mocked (Cube/Trino are out of scope here); this verifies wiring, validation,
 * and the structural-vs-transient error mapping.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';

vi.mock('../src/services/compute-segment-size.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/services/compute-segment-size.js')>();
  return { ...actual, computeSegmentSize: vi.fn() };
});
import * as sizeSvc from '../src/services/compute-segment-size.js';
const mockSize = sizeSvc.computeSegmentSize as MockedFunction<typeof sizeSvc.computeSegmentSize>;
const { SegmentSizeError } = sizeSvc;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const TREE = {
  kind: 'group',
  id: 'g',
  op: 'AND',
  children: [
    { kind: 'leaf', id: 'l1', member: 'mf_users.country', type: 'string', op: 'equals', values: ['VN'] },
  ],
};

describe('POST /api/segments/preview-count', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let auth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    mockSize.mockReset();
    app = await buildApp();
    auth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice-sub', email: 'alice@corp.com', role: 'editor' })}`,
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  function call(payload: unknown) {
    return app.inject({ method: 'POST', url: '/api/segments/preview-count', headers: auth, payload: payload as object });
  }

  it('returns ok:true with the estimated count', async () => {
    mockSize.mockResolvedValue({ count: 4321, identityField: 'mf_users.user_id' });
    const res = await call({ game_id: 'cfm_vn', cube: 'mf_users', predicate_tree: TREE });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.estCount).toBe(4321);
    expect(typeof body.tookMs).toBe('number');
  });

  it('maps an uncohortable cube to 400', async () => {
    mockSize.mockRejectedValue(new SegmentSizeError('uncohortable', 'no identity-field mapping for weird_cube'));
    const res = await call({ game_id: 'cfm_vn', cube: 'weird_cube', predicate_tree: TREE });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('UNCOHORTABLE');
  });

  it('degrades a transient Cube error to ok:false (200), never breaks the caller', async () => {
    mockSize.mockRejectedValue(new Error('fetch failed'));
    const res = await call({ game_id: 'cfm_vn', cube: 'mf_users', predicate_tree: TREE });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('unavailable');
  });

  it('rejects a body missing game_id with 400', async () => {
    const res = await call({ cube: 'mf_users', predicate_tree: TREE });
    expect(res.statusCode).toBe(400);
    expect(mockSize).not.toHaveBeenCalled();
  });
});
