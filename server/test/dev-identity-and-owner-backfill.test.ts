/**
 * dev-identity + dev-owner-backfill — the AUTH_DISABLED identity is the first
 * bootstrap admin (default khoitn@vng.com.vn) and legacy 'dev'-owned rows are
 * rewritten to it at boot, ONLY in dev mode.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { devAdminEmail, devOwnerSub, devUsername, DEFAULT_DEV_ADMIN_EMAIL } from '../src/auth/dev-identity.js';
import { backfillLegacyDevOwner } from '../src/auth/dev-owner-backfill.js';

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

const prevEnv = {
  AUTH_DISABLED: process.env.AUTH_DISABLED,
  AUTH_BOOTSTRAP_ADMINS: process.env.AUTH_BOOTSTRAP_ADMINS,
};

afterEach(() => {
  process.env.AUTH_DISABLED = prevEnv.AUTH_DISABLED;
  if (prevEnv.AUTH_BOOTSTRAP_ADMINS === undefined) delete process.env.AUTH_BOOTSTRAP_ADMINS;
  else process.env.AUTH_BOOTSTRAP_ADMINS = prevEnv.AUTH_BOOTSTRAP_ADMINS;
  closeDb();
});

describe('dev-identity', () => {
  it('defaults to the org first admin when AUTH_BOOTSTRAP_ADMINS is unset', () => {
    delete process.env.AUTH_BOOTSTRAP_ADMINS;
    expect(devAdminEmail()).toBe(DEFAULT_DEV_ADMIN_EMAIL);
    expect(devOwnerSub()).toBe(DEFAULT_DEV_ADMIN_EMAIL);
    expect(devUsername()).toBe('khoitn');
  });

  it('uses the FIRST bootstrap admin when configured', () => {
    process.env.AUTH_BOOTSTRAP_ADMINS = 'alice@corp.com, bob@corp.com';
    expect(devAdminEmail()).toBe('alice@corp.com');
    expect(devUsername()).toBe('alice');
  });
});

describe('backfillLegacyDevOwner', () => {
  function seedDevRows(db: Database.Database) {
    db.prepare(
      `INSERT INTO segments (id, name, type, owner) VALUES ('seg-1', 'S1', 'manual', 'dev')`,
    ).run();
    db.prepare(
      `INSERT INTO user_prefs (owner, key, value, updated_at) VALUES ('dev', 'theme', 'dark', '2026-01-01')`,
    ).run();
  }

  it('is a no-op when AUTH_DISABLED is off (real-auth stacks never rewrite)', () => {
    process.env.AUTH_DISABLED = 'false';
    const db = makeMemDb();
    setDb(db);
    seedDevRows(db);
    expect(backfillLegacyDevOwner()).toEqual({});
    expect(db.prepare(`SELECT owner FROM segments WHERE id='seg-1'`).get()).toEqual({ owner: 'dev' });
  });

  it('rewrites dev-owned rows to the bootstrap-admin sub under AUTH_DISABLED', () => {
    process.env.AUTH_DISABLED = 'true';
    delete process.env.AUTH_BOOTSTRAP_ADMINS;
    const db = makeMemDb();
    setDb(db);
    seedDevRows(db);

    const changed = backfillLegacyDevOwner();
    expect(changed['segments']).toBe(1);
    expect(changed['user_prefs']).toBe(1);
    expect(db.prepare(`SELECT owner FROM segments WHERE id='seg-1'`).get())
      .toEqual({ owner: DEFAULT_DEV_ADMIN_EMAIL });

    // Idempotent: second run finds nothing.
    expect(backfillLegacyDevOwner()).toEqual({});
  });

  it("rewrites the legacy 'khoitn' seed alias too — one identity for the same person", () => {
    process.env.AUTH_DISABLED = 'true';
    delete process.env.AUTH_BOOTSTRAP_ADMINS;
    const db = makeMemDb();
    setDb(db);
    db.prepare(
      `INSERT INTO segments (id, name, type, owner) VALUES ('seg-k', 'S-k', 'manual', 'khoitn')`,
    ).run();

    expect(backfillLegacyDevOwner()['segments']).toBe(1);
    expect(db.prepare(`SELECT owner FROM segments WHERE id='seg-k'`).get())
      .toEqual({ owner: DEFAULT_DEV_ADMIN_EMAIL });
  });

  it('drops the stale dev row when the new owner already holds the unique key', () => {
    process.env.AUTH_DISABLED = 'true';
    delete process.env.AUTH_BOOTSTRAP_ADMINS;
    const db = makeMemDb();
    setDb(db);
    db.prepare(
      `INSERT INTO user_prefs (owner, key, value, updated_at) VALUES (?, 'theme', 'light', '2026-02-01')`,
    ).run(DEFAULT_DEV_ADMIN_EMAIL);
    db.prepare(
      `INSERT INTO user_prefs (owner, key, value, updated_at) VALUES ('dev', 'theme', 'dark', '2026-01-01')`,
    ).run();

    backfillLegacyDevOwner();

    // The pre-existing new-owner row wins; the colliding 'dev' duplicate is gone.
    const rows = db.prepare(`SELECT owner, value FROM user_prefs WHERE key='theme'`).all();
    expect(rows).toEqual([{ owner: DEFAULT_DEV_ADMIN_EMAIL, value: 'light' }]);
  });
});
