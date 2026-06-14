/**
 * Durable Care-tab cache (segment_care_cache): write→read round-trip, age
 * semantics, and last-good preservation on a failed attempt.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import {
  readCareCache,
  writeCareCache,
  markCareAttempt,
  listCareCacheStatuses,
  __clearCareCache,
} from '../src/db/segment-care-cache-store.js';
import type { CsCarePayload } from '../src/services/cs-care-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

function fakePayload(tickets = 12): CsCarePayload {
  return {
    segmentId: 'seg-a',
    gameId: 'cfm_vn',
    productId: 1,
    coverage: { totalMembers: 100, contactedMembers: 8, pct: 8, truncated: false },
    freshness: { csMaxLogDate: '2026-06-14' },
    pulse: { tickets, contacted: 8, openUnresolved: 2, negativeSentiment: 1, lowRating: 0 },
    issueMix: [],
    watchlist: [],
    csImpact: null,
  };
}

describe('segment-care-cache-store', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('writes then reads back the payload with a fresh computed_at', () => {
    writeCareCache('seg-a', 'cfm_vn', fakePayload(12));
    const read = readCareCache('seg-a');
    expect(read).not.toBeNull();
    expect(read!.payload.pulse.tickets).toBe(12);
    expect(read!.status).toBe('ok');
    expect(read!.lastError).toBeNull();
    expect(read!.ageMs).toBeGreaterThanOrEqual(0);
  });

  it('returns null for a segment that was never cached', () => {
    expect(readCareCache('nope')).toBeNull();
  });

  it('preserves the last-good payload when a later attempt fails', () => {
    writeCareCache('seg-a', 'cfm_vn', fakePayload(20));
    markCareAttempt('seg-a', 'cfm_vn', 'Trino read timeout');

    const read = readCareCache('seg-a');
    // payload survives the failed attempt — serve-stale relies on this.
    expect(read).not.toBeNull();
    expect(read!.payload.pulse.tickets).toBe(20);
    expect(read!.lastError).toBe('Trino read timeout');
    expect(read!.status).toBe('error');
  });

  it('a failure with no prior payload yields a payload-less error row (true 502 case)', () => {
    markCareAttempt('seg-b', 'cfm_vn', 'cold warehouse');
    // readCareCache returns null (no payload to serve) — route must 502.
    expect(readCareCache('seg-b')).toBeNull();
    // …but the board still sees the segment as erroring.
    const statuses = listCareCacheStatuses();
    const b = statuses.find((s) => s.segmentId === 'seg-b');
    expect(b).toMatchObject({ status: 'error', hasPayload: false, lastError: 'cold warehouse' });
  });

  it('a fresh success clears the prior error', () => {
    markCareAttempt('seg-a', 'cfm_vn', 'boom');
    writeCareCache('seg-a', 'cfm_vn', fakePayload(5));
    const read = readCareCache('seg-a');
    expect(read!.lastError).toBeNull();
    expect(read!.status).toBe('ok');
  });

  it('listCareCacheStatuses reports freshness without the payload', () => {
    writeCareCache('seg-a', 'cfm_vn', fakePayload());
    const [s] = listCareCacheStatuses();
    expect(s).toMatchObject({ segmentId: 'seg-a', gameId: 'cfm_vn', status: 'ok', hasPayload: true });
    expect(s.computedAt).not.toBeNull();
  });

  it('__clearCareCache wipes all rows', () => {
    writeCareCache('seg-a', 'cfm_vn', fakePayload());
    __clearCareCache();
    expect(listCareCacheStatuses()).toHaveLength(0);
  });
});
