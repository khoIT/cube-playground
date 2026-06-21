/**
 * Decision lock: under AUTH_DISABLED the bootstrap admin must see EVERYTHING.
 *
 * AUTH_DISABLED runs on local dev AND the VPN-gated playground (treated as an
 * internal admin "production"). Both resolve every request to the bootstrap
 * admin, and on those trusted deployments the operator is meant to see full
 * payer/CS/VIP data — redaction there would only blind the admin. The
 * sensitive-column gate is therefore Boolean(req.user), which is open under
 * AUTH_DISABLED by design.
 *
 * This test pins that intent: it FAILS if someone re-introduces a gate that
 * redacts the synthetic admin (e.g. a token-verified-only signal). Real-auth
 * tokenless redaction is covered separately in segment-movement-security.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const readStateDistributionMock = vi.fn();

vi.mock('../src/lakehouse/segment-movement-reader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lakehouse/segment-movement-reader.js')>();
  return {
    ...actual,
    readStateDistribution: (...args: unknown[]) => readStateDistributionMock(...args),
    readStateDistributionTrend: vi.fn().mockResolvedValue([]),
    readKpiTrend: vi.fn().mockResolvedValue([]),
    readMovementSeries: vi.fn().mockResolvedValue([]),
    readCadenceHistory: vi.fn().mockResolvedValue([]),
  };
});

import { buildApp } from '../src/index.js';
import { setDb } from '../src/db/sqlite.js';
import { __clearMovementCache } from '../src/routes/segment-movement.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe('segment-movement under AUTH_DISABLED — admin sees everything', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let segmentId: string;
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    prevEnv.AUTH_DISABLED = process.env.AUTH_DISABLED;
    prevEnv.NODE_ENV = process.env.NODE_ENV;
    // Mirror the local / playground posture.
    process.env.AUTH_DISABLED = 'true';
    process.env.NODE_ENV = 'development';

    setDb(makeMemDb());
    __clearMovementCache();
    readStateDistributionMock.mockReset().mockResolvedValue([{ dimension: 'whale', count: 42 }]);

    app = await buildApp();

    const seg = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: {
        name: 'auth-disabled-admin-segment',
        type: 'predicate',
        cube: 'mf_users',
        game_id: 'cfm_vn',
        cube_query_json: '{"dimensions":["mf_users.uid"]}',
        predicate_tree_json: '{"op":"and","children":[]}',
      },
    });
    expect(seg.statusCode).toBe(201);
    segmentId = JSON.parse(seg.body).id as string;

    return () => {
      process.env.AUTH_DISABLED = prevEnv.AUTH_DISABLED;
      process.env.NODE_ENV = prevEnv.NODE_ENV;
    };
  });

  it('serves a SENSITIVE dimension unredacted to the AUTH_DISABLED admin (no token)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/segments/${segmentId}/state-distribution`,
      // No Authorization header — under AUTH_DISABLED this is still the admin.
      query: { dimension: 'payer_tier', ts: '2026-06-01' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { redacted: boolean; rows: unknown[] };
    // Admin context: sensitive dim is NOT redacted.
    expect(body.redacted).toBe(false);
    expect(body.rows).toHaveLength(1);
  });

  it('serves a non-sensitive dimension too', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/segments/${segmentId}/state-distribution`,
      query: { dimension: 'lifecycle_stage', ts: '2026-06-01' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { redacted: boolean; rows: unknown[] };
    expect(body.redacted).toBe(false);
    expect(body.rows).toHaveLength(1);
  });
});
