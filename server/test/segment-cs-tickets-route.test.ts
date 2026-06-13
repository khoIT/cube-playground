/**
 * Per-member CS-tickets route — gate (404 NO_CS_CARE for non-predicate/uncovered),
 * guard (404 unknown), uid validation (400), membership assertion (404
 * NOT_IN_SEGMENT), graceful empty (200 joined=false), 502 on reader failure, TTL
 * cache (second hit = zero reads), and the route-level ticket cap. Reader mocked;
 * auth + segment store run for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const fetchDetailMock = vi.fn();
vi.mock('../src/lakehouse/cs-ticket-detail-reader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lakehouse/cs-ticket-detail-reader.js')>();
  return {
    ...actual,
    fetchCsTicketDetail: (...args: unknown[]) => fetchDetailMock(...args),
  };
});

import { buildApp } from '../src/index.js';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import { __clearCsTicketsCache } from '../src/routes/segment-cs-tickets.js';
import type { CsTicketDetail } from '../src/lakehouse/cs-ticket-detail-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';
const MEMBER = '3326386729574596608';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

function ticket(over: Partial<CsTicketDetail> = {}): CsTicketDetail {
  return {
    ticketId: '26530832',
    uid: MEMBER,
    source: 'Web',
    formName: 'Form',
    openedAt: '2026-02-05',
    status: 'Closed',
    priority: 5,
    staffDept: 'CTS',
    staffDomain: 'agent',
    latencyMin: 23,
    reopenCount: 2,
    sentiment: { first: 'Neutral', last: 'Negative', change: 'Change Status' },
    securityFlag: false,
    loginInfo: MEMBER,
    tags: ['#NTH-Question'],
    labels: [{ category: 'Payment', name: 'Payment_Question' }],
    rating: { rating: 1, feedback: 'meh', feedbackOptions: [] },
    messages: [{ at: '2026-02-05 15:00:00', isCustomer: true, text: 'hi', attachments: [] }],
    messagesTruncated: false,
    vip: { tierId: 4, vipGameProportion: 0.75, loginChannel: null, gender: null },
    ...over,
  };
}

describe('GET /api/segments/:id/members/:uid/cs-tickets', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let auth: { authorization: string };
  let predicateId: string;
  let manualId: string;

  async function makeSegment(payload: Record<string, unknown>): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/segments', headers: auth, payload });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    __clearCsTicketsCache();
    fetchDetailMock.mockReset();
    fetchDetailMock.mockResolvedValue([ticket()]);
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    auth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice', email: 'alice@corp.com', role: 'editor' })}`,
    };

    predicateId = await makeSegment({
      name: 'cs predicate seg',
      type: 'predicate',
      cube: 'mf_users',
      game_id: 'jus_vn',
      cube_query_json: '{"dimensions":["mf_users.user_id"]}',
      predicate_tree_json: '{"op":"and","children":[]}',
    });
    // Populate the refresh-time member snapshot the membership assertion reads.
    getDb().prepare('UPDATE segments SET uid_list_json = ? WHERE id = ?').run(JSON.stringify([MEMBER]), predicateId);

    manualId = await makeSegment({ name: 'manual seg', type: 'manual', uid_list: ['u1'], game_id: 'jus_vn' });
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  const url = (id: string, uid = MEMBER) => `/api/segments/${id}/members/${uid}/cs-tickets`;

  it('returns full ticket detail for an authorized predicate segment + member', async () => {
    const res = await app.inject({ method: 'GET', url: url(predicateId), headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uid).toBe(MEMBER);
    expect(body.gameId).toBe('jus_vn');
    expect(body.coverage.joined).toBe(true);
    expect(body.tickets).toHaveLength(1);
    expect(body.freshness.csMaxLogDate).toBe('2026-02-05');
    // member decoration + recharge always present; recharge degrades to null
    // here (no Trino connector in tests) without failing the endpoint.
    expect(body.member).toEqual({ name: null, ltv: null });
    expect(body.recharge).toBeNull();
  });

  it('404 NO_CS_CARE for a non-predicate (manual) segment, before touching Trino', async () => {
    const res = await app.inject({ method: 'GET', url: url(manualId, 'u1'), headers: auth });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NO_CS_CARE');
    expect(fetchDetailMock).not.toHaveBeenCalled();
  });

  it('404 via guard for an unknown segment', async () => {
    const res = await app.inject({ method: 'GET', url: url('nope'), headers: auth });
    expect(res.statusCode).toBe(404);
    expect(fetchDetailMock).not.toHaveBeenCalled();
  });

  it('400 BAD_UID for an invalid uid', async () => {
    const res = await app.inject({ method: 'GET', url: url(predicateId, 'bad!uid'), headers: auth });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_UID');
    expect(fetchDetailMock).not.toHaveBeenCalled();
  });

  it('404 NOT_IN_SEGMENT when the uid is valid but not a member', async () => {
    const res = await app.inject({ method: 'GET', url: url(predicateId, '9999999999'), headers: auth });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_IN_SEGMENT');
    expect(fetchDetailMock).not.toHaveBeenCalled();
  });

  it('200 with empty tickets + coverage.joined=false for an unjoinable/quiet member', async () => {
    fetchDetailMock.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: url(predicateId), headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().coverage.joined).toBe(false);
    expect(res.json().tickets).toHaveLength(0);
  });

  it('502 CS_TICKETS_UNAVAILABLE when the reader throws (and does not cache failure)', async () => {
    fetchDetailMock.mockRejectedValueOnce(new Error('trino down'));
    const fail = await app.inject({ method: 'GET', url: url(predicateId), headers: auth });
    expect(fail.statusCode).toBe(502);
    expect(fail.json().error.code).toBe('CS_TICKETS_UNAVAILABLE');
    const ok = await app.inject({ method: 'GET', url: url(predicateId), headers: auth });
    expect(ok.statusCode).toBe(200);
  });

  it('serves a repeat call from cache with zero reader reads', async () => {
    await app.inject({ method: 'GET', url: url(predicateId), headers: auth });
    await app.inject({ method: 'GET', url: url(predicateId), headers: auth });
    expect(fetchDetailMock).toHaveBeenCalledTimes(1);
  });

  it('caps tickets to MAX_TICKETS (60) at the route boundary', async () => {
    fetchDetailMock.mockResolvedValue(Array.from({ length: 75 }, (_, i) => ticket({ ticketId: `t${i}` })));
    const res = await app.inject({ method: 'GET', url: url(predicateId), headers: auth });
    expect(res.json().tickets).toHaveLength(60);
  });
});
