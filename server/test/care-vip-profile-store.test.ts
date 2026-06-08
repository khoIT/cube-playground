/**
 * Persisted VIP profile store: upsert/read round-trip, idempotent overwrite,
 * scoping by (workspace, game), and churn-pay derivation from last_recharge_date.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import {
  upsertVipProfiles,
  getVipProfiles,
  daysSince,
  toDto,
} from '../src/care/care-vip-profile-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const NOW = Date.parse('2026-06-09T00:00:00Z');

describe('daysSince / toDto', () => {
  it('derives whole churn-pay days, clamps future, rejects junk', () => {
    expect(daysSince('2026-05-26T00:00:00Z', NOW)).toBe(14);
    expect(daysSince('2026-07-01T00:00:00Z', NOW)).toBe(0);
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince('nope', NOW)).toBeNull();
  });

  it('maps a row to the DTO with derived churn-pay days', () => {
    const dto = toDto(
      { uid: 'v', name: 'Main', ltv_vnd: 944_000_000, tier: 'Diamond', days_since_last_active: 12, last_recharge_date: '2026-05-26T00:00:00Z' },
      NOW,
    );
    expect(dto).toEqual({ name: 'Main', ltvVnd: 944_000_000, tier: 'Diamond', churnPlayDays: 12, churnPayDays: 14 });
  });
});

describe('upsertVipProfiles / getVipProfiles', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('round-trips, overwrites on re-upsert, scopes by game, omits unknown uids', () => {
    upsertVipProfiles('jus_vn', 'local', [
      { uid: 'a', name: 'Alpha', ltvVnd: 10_000_000, tier: 'Gold', daysSinceLastActive: 3, lastRechargeDate: '2026-06-02T00:00:00Z' },
      { uid: 'b', name: 'Bravo', ltvVnd: 50_000_000, tier: 'Diamond', daysSinceLastActive: 1, lastRechargeDate: null },
    ]);

    const map = getVipProfiles('jus_vn', 'local', ['a', 'b', 'missing'], NOW);
    expect(map.size).toBe(2);
    expect(map.get('a')).toEqual({ name: 'Alpha', ltvVnd: 10_000_000, tier: 'Gold', churnPlayDays: 3, churnPayDays: 7 });
    expect(map.get('b')!.churnPayDays).toBeNull(); // never recharged
    expect(map.has('missing')).toBe(false);

    // Re-upsert overwrites in place (no duplicate rows).
    upsertVipProfiles('jus_vn', 'local', [
      { uid: 'a', name: 'AlphaRenamed', ltvVnd: 11_000_000, tier: 'Diamond', daysSinceLastActive: 0, lastRechargeDate: '2026-06-09T00:00:00Z' },
    ]);
    const after = getVipProfiles('jus_vn', 'local', ['a'], NOW);
    expect(after.get('a')).toEqual({ name: 'AlphaRenamed', ltvVnd: 11_000_000, tier: 'Diamond', churnPlayDays: 0, churnPayDays: 0 });

    // A different game is isolated.
    expect(getVipProfiles('cfm_vn', 'local', ['a'], NOW).size).toBe(0);
  });

  it('empty input → empty map, no query', () => {
    expect(getVipProfiles('jus_vn', 'local', [], NOW).size).toBe(0);
  });
});
