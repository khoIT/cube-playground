/**
 * Phase 2 — access store: grant resolution, feature override precedence,
 * cache invalidation, and the last-admin guard.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'access-store-test-'));
process.env.DB_PATH = join(tmp, 'access.db');
process.env.ACCESS_CACHE_TTL_MS = '10000';

import { getDb, closeDb } from '../src/db/sqlite.js';
import {
  getAccess,
  listUsers,
  normalizeEmail,
  __resetAccessCache,
} from '../src/auth/access-store.js';
import {
  upsertUserAccess,
  setRole,
  setStatus,
  setWorkspaces,
  setGames,
  setFeatures,
  ensurePendingUser,
  reconcileSub,
  LastAdminError,
} from '../src/auth/access-store-mutators.js';

function wipe(): void {
  const db = getDb();
  db.exec(
    'DELETE FROM user_access; DELETE FROM user_workspace_access; DELETE FROM user_game_access; DELETE FROM feature_flags;',
  );
  __resetAccessCache();
}

beforeEach(() => wipe());

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('access-store', () => {
  it('returns null for unknown email', () => {
    expect(getAccess('nobody@corp.com')).toBeNull();
  });

  it('normalizes email on read and write', () => {
    upsertUserAccess({ email: 'Alice@Corp.com', role: 'editor', status: 'active' });
    const rec = getAccess('  alice@corp.COM ');
    expect(rec?.email).toBe('alice@corp.com');
    expect(rec?.role).toBe('editor');
    expect(normalizeEmail(' A@B.com ')).toBe('a@b.com');
  });

  it('resolves merged workspace + game grants', () => {
    upsertUserAccess({ email: 'u@corp.com', role: 'viewer', status: 'active' });
    setWorkspaces('u@corp.com', ['prod', 'local']);
    setGames('u@corp.com', ['ptg', 'ballistar']);
    const rec = getAccess('u@corp.com')!;
    expect(rec.workspaces.sort()).toEqual(['local', 'prod']);
    expect(rec.games.sort()).toEqual(['ballistar', 'ptg']);
  });

  it('feature defaults: admin off, others on', () => {
    upsertUserAccess({ email: 'u@corp.com', role: 'viewer', status: 'active' });
    const f = getAccess('u@corp.com')!.features;
    expect(f.admin).toBe(false);
    expect(f.dashboards).toBe(true);
  });

  it('user-scope feature flag overrides role-scope', () => {
    upsertUserAccess({ email: 'u@corp.com', role: 'editor', status: 'active' });
    // role-scope disables dashboards for editors…
    getDb()
      .prepare(
        "INSERT INTO feature_flags (scope, subject, feature_key, enabled) VALUES ('role','editor','dashboards',0)",
      )
      .run();
    __resetAccessCache();
    expect(getAccess('u@corp.com')!.features.dashboards).toBe(false);
    // …user-scope re-enables it for this user.
    setFeatures('u@corp.com', { dashboards: true });
    expect(getAccess('u@corp.com')!.features.dashboards).toBe(true);
  });

  it('cache invalidates on write', () => {
    upsertUserAccess({ email: 'u@corp.com', role: 'viewer', status: 'active' });
    expect(getAccess('u@corp.com')!.role).toBe('viewer'); // primes cache
    setRole('u@corp.com', 'editor');
    expect(getAccess('u@corp.com')!.role).toBe('editor');
  });

  it('ensurePendingUser creates pending row + reconciles sub', () => {
    ensurePendingUser('new@corp.com', 'kc-sub-1');
    const rec = getAccess('new@corp.com')!;
    expect(rec.status).toBe('pending');
    expect(rec.kcSub).toBe('kc-sub-1');
    // existing row, missing sub → reconcile
    upsertUserAccess({ email: 'has@corp.com', role: 'viewer', status: 'active' });
    reconcileSub('has@corp.com', 'kc-sub-2');
    expect(getAccess('has@corp.com')!.kcSub).toBe('kc-sub-2');
    // sub never overwritten
    reconcileSub('has@corp.com', 'kc-sub-OTHER');
    expect(getAccess('has@corp.com')!.kcSub).toBe('kc-sub-2');
  });

  it('guards the last active admin', () => {
    upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
    expect(() => setRole('admin@corp.com', 'viewer')).toThrow(LastAdminError);
    expect(() => setStatus('admin@corp.com', 'disabled')).toThrow(LastAdminError);
    // with a second admin, demotion is allowed
    upsertUserAccess({ email: 'admin2@corp.com', role: 'admin', status: 'active' });
    expect(() => setRole('admin@corp.com', 'viewer')).not.toThrow();
  });

  it('listUsers returns all rows with grants', () => {
    upsertUserAccess({ email: 'a@corp.com', role: 'admin', status: 'active' });
    upsertUserAccess({ email: 'b@corp.com', role: 'viewer', status: 'pending' });
    const users = listUsers();
    expect(users.map((u) => u.email).sort()).toEqual(['a@corp.com', 'b@corp.com']);
    expect(users.find((u) => u.email === 'a@corp.com')?.role).toBe('admin');
  });
});
