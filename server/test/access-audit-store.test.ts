/**
 * access-audit-store read side — filtered audit-log query + latest-per-target.
 * The write side (recordAccessAudit) is exercised by the admin-access route
 * tests; here we lock the read contract the audit-log viewer + "last changed"
 * affordance depend on.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, getDb } from '../src/db/sqlite.js';
import {
  recordAccessAudit,
  queryAccessAudit,
  latestAuditForTarget,
} from '../src/auth/access-audit-store.js';

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

/** Insert a row with an explicit ts so ordering is deterministic. */
function seedRow(actor: string, action: string, target: string, ts: string, detail?: unknown) {
  getDb()
    .prepare(
      `INSERT INTO access_audit (actor_email, action, target_email, detail_json, ts)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(actor.toLowerCase(), action, target.toLowerCase(), detail === undefined ? null : JSON.stringify(detail), ts);
}

describe('access-audit-store read side', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    seedRow('admin@corp.com', 'create_user', 'bob@corp.com', '2026-01-01T10:00:00.000Z', { role: 'viewer' });
    seedRow('admin@corp.com', 'set_role', 'bob@corp.com', '2026-01-02T10:00:00.000Z', { role: 'editor' });
    seedRow('boss@corp.com', 'set_games', 'carol@corp.com', '2026-01-03T10:00:00.000Z', { games: ['muaw'] });
  });

  it('returns all rows newest-first when unfiltered', () => {
    const rows = queryAccessAudit();
    expect(rows.map((r) => r.action)).toEqual(['set_games', 'set_role', 'create_user']);
    // detail is parsed back to an object
    expect(rows[0].detail).toEqual({ games: ['muaw'] });
  });

  it('filters by exact action', () => {
    const rows = queryAccessAudit({ action: 'set_role' });
    expect(rows).toHaveLength(1);
    expect(rows[0].targetEmail).toBe('bob@corp.com');
  });

  it('filters by target substring (case-insensitive)', () => {
    expect(queryAccessAudit({ target: 'BOB' }).map((r) => r.action)).toEqual(['set_role', 'create_user']);
  });

  it('filters by actor substring', () => {
    expect(queryAccessAudit({ actor: 'boss' })).toHaveLength(1);
  });

  it('filters by ts range (inclusive)', () => {
    const rows = queryAccessAudit({ from: '2026-01-02T00:00:00.000Z', to: '2026-01-02T23:59:59.999Z' });
    expect(rows.map((r) => r.action)).toEqual(['set_role']);
  });

  it('caps rows by limit', () => {
    expect(queryAccessAudit({ limit: 1 })).toHaveLength(1);
  });

  it('tolerates a malformed detail_json row (detail → null, no throw)', () => {
    getDb()
      .prepare(`INSERT INTO access_audit (actor_email, action, target_email, detail_json, ts) VALUES (?,?,?,?,?)`)
      .run('admin@corp.com', 'set_role', 'dan@corp.com', '{not json', '2026-01-04T10:00:00.000Z');
    const rows = queryAccessAudit({ target: 'dan' });
    expect(rows[0].detail).toBeNull();
  });

  it('latestAuditForTarget returns the newest entry for a user', () => {
    const latest = latestAuditForTarget('bob@corp.com');
    expect(latest?.action).toBe('set_role');
    expect(latest?.actorEmail).toBe('admin@corp.com');
  });

  it('latestAuditForTarget returns null for an unknown target', () => {
    expect(latestAuditForTarget('nobody@corp.com')).toBeNull();
  });

  it('recordAccessAudit round-trips through the read side', () => {
    recordAccessAudit({ actorEmail: 'Admin@Corp.com', action: 'set_features', targetEmail: 'Eve@Corp.com', detail: { features: { admin: true } } });
    const latest = latestAuditForTarget('eve@corp.com');
    expect(latest?.action).toBe('set_features');
    expect(latest?.actorEmail).toBe('admin@corp.com'); // normalized lowercase
    expect(latest?.detail).toEqual({ features: { admin: true } });
  });
});
