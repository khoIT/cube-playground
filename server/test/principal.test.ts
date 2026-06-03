/**
 * Identity resolver — sub↔email mapping via the canonical `user_access.kc_sub`
 * map, and the dev-mode synthetic-email fallback used for multi-user simulation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import {
  resolvePrincipal,
  emailForSub,
  subForEmail,
  DEV_EMAIL_DOMAIN,
} from '../src/auth/principal.js';

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

function seedAccess(email: string, kcSub: string | null) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO user_access (email, role, status, kc_sub, created_at, updated_at)
       VALUES (?, 'editor', 'active', ?, ?, ?)`,
    )
    .run(email, kcSub, now, now);
}

// Minimal request stub — resolvePrincipal only reads owner + user.
function req(owner: string, user?: Record<string, unknown>) {
  return { owner, user } as never;
}

const devUser = { id: 'dev', username: 'dev', role: 'admin', allowedGames: [], workspaces: [], features: {} };

describe('principal — sub↔email via user_access.kc_sub', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('round-trips sub↔email (email normalized)', () => {
    seedAccess('alice@corp.com', 'kc-alice');
    expect(emailForSub('kc-alice')).toBe('alice@corp.com');
    expect(subForEmail('alice@corp.com')).toBe('kc-alice');
    expect(subForEmail('  ALICE@Corp.com ')).toBe('kc-alice');
  });

  it('returns null when an email is pre-provisioned but not yet logged in (kc_sub NULL)', () => {
    seedAccess('pending@corp.com', null);
    expect(subForEmail('pending@corp.com')).toBeNull();
  });

  it('returns null for an unknown sub or email', () => {
    expect(emailForSub('nobody')).toBeNull();
    expect(subForEmail('nobody@corp.com')).toBeNull();
  });

  it('prefers the authenticated token email over the synth fallback', () => {
    const p = resolvePrincipal(
      req('kc-bob', { ...devUser, id: 'kc-bob', username: 'bob', email: 'bob@corp.com', role: 'editor' }),
    );
    expect(p.sub).toBe('kc-bob');
    expect(p.email).toBe('bob@corp.com');
    expect(p.role).toBe('editor');
  });

  it('synthesizes a non-routable dev email when no real email is available', () => {
    const p = resolvePrincipal(req('dev', devUser));
    expect(p.email).toBe(`dev@${DEV_EMAIL_DOMAIN}`);
    expect(p.email!.endsWith('.invalid')).toBe(true);
  });

  it('resolves a seeded email for an X-Owner sub in dev (multi-user simulation)', () => {
    seedAccess('carol@corp.com', 'carol-sub');
    const p = resolvePrincipal(req('carol-sub', devUser));
    expect(p.email).toBe('carol@corp.com');
  });

  it('distinct X-Owner subs yield distinct synth identities (no collapse to one user)', () => {
    const a = resolvePrincipal(req('owner-a', devUser));
    const b = resolvePrincipal(req('owner-b', devUser));
    expect(a.email).not.toBe(b.email);
  });

  it('default-denies grants for an authenticated-but-unauthorized (no user) request', () => {
    const p = resolvePrincipal(req('kc-ghost', undefined));
    expect(p.sub).toBe('kc-ghost');
    expect(p.role).toBe('viewer');
    expect(p.workspaces).toEqual([]);
    expect(p.allowedGames).toEqual([]);
  });
});
