/**
 * Phase 01 — API-key store + scope checks for the public export surface.
 *
 * Covers: mint→verify round-trip via the stored hash (plaintext never stored),
 * revoked/expired rejection, prefix-guard, and the workspace/segment/game scope
 * allowlist boundary (fail-closed).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createKey,
  verifyKey,
  revokeKey,
  revealKey,
  updateKeyExpiry,
  listKeys,
  __resetApiKeyCaches,
} from '../src/auth/api-key-store.js';
import { canKeyAccessSegment } from '../src/auth/api-key-scope.js';

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

describe('api-key store', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    __resetApiKeyCaches();
  });
  afterEach(() => {
    closeDb();
    __resetApiKeyCaches();
  });

  it('mints a sk_live_ key, verifies it, and never persists the plaintext', () => {
    const { plaintext, item } = createKey({
      label: 'downstream-app',
      workspace: 'prod',
      createdBy: 'admin@vng.com.vn',
    });
    expect(plaintext.startsWith('sk_live_')).toBe(true);
    expect(item.keyPrefix.startsWith('sk_live_')).toBe(true);
    // Prefix is a crumb only — must not reveal the whole secret.
    expect(plaintext.startsWith(item.keyPrefix)).toBe(true);
    expect(item.keyPrefix.length).toBeLessThan(plaintext.length);

    const scope = verifyKey(plaintext);
    expect(scope).not.toBeNull();
    expect(scope?.workspace).toBe('prod');
    expect(scope?.role).toBe('export-reader');
    expect(scope?.segmentIds).toBeNull();
    expect(scope?.gameIds).toBeNull();
  });

  it('rejects unknown keys and bad prefixes', () => {
    expect(verifyKey('sk_live_doesnotexist')).toBeNull();
    expect(verifyKey('not-a-key')).toBeNull();
  });

  it('rejects a revoked key', () => {
    const { plaintext, item } = createKey({
      label: 'x',
      workspace: 'prod',
      createdBy: 'admin@vng.com.vn',
    });
    expect(verifyKey(plaintext)).not.toBeNull();
    __resetApiKeyCaches();
    expect(revokeKey(item.id)).toBe(true);
    expect(verifyKey(plaintext)).toBeNull();
    expect(listKeys()[0].status).toBe('revoked');
  });

  it('rejects an expired key', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const { plaintext } = createKey({
      label: 'x',
      workspace: 'prod',
      createdBy: 'admin@vng.com.vn',
      expiresAt: past,
    });
    expect(verifyKey(plaintext)).toBeNull();
  });

  it('reveals the plaintext on demand (raw storage, no vault key)', () => {
    delete process.env.CONNECTOR_SECRET_KEY; // force raw (unsealed) storage path
    const { plaintext, item } = createKey({ label: 'r', workspace: 'prod', createdBy: 'a@b.c' });
    expect(item.recoverable).toBe(true);
    const r = revealKey(item.id);
    expect(r.ok && r.plaintext).toBe(plaintext);
  });

  it('reveals the plaintext when sealed with a vault key', () => {
    // 32-byte key (base64) so the vault seals/opens the secret.
    process.env.CONNECTOR_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
    try {
      const { plaintext, item } = createKey({ label: 'sealed', workspace: 'prod', createdBy: 'a@b.c' });
      const r = revealKey(item.id);
      expect(r.ok && r.plaintext).toBe(plaintext);
    } finally {
      delete process.env.CONNECTOR_SECRET_KEY;
    }
  });

  it('reveal reports not_found for an unknown id', () => {
    expect(revealKey('key_nope')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('extending expiry re-validates an expired key (same secret)', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const { plaintext, item } = createKey({
      label: 'exp', workspace: 'prod', createdBy: 'a@b.c', expiresAt: past,
    });
    expect(verifyKey(plaintext)).toBeNull(); // expired
    __resetApiKeyCaches();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(updateKeyExpiry(item.id, future)).toBe(true);
    expect(verifyKey(plaintext)).not.toBeNull(); // valid again
  });

  it('flags expiringSoon within the window but not far-future', () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const far = new Date(Date.now() + 60 * 86_400_000).toISOString();
    createKey({ label: 'soon', workspace: 'prod', createdBy: 'a@b.c', expiresAt: soon });
    createKey({ label: 'far', workspace: 'prod', createdBy: 'a@b.c', expiresAt: far });
    const byLabel = Object.fromEntries(listKeys().map((k) => [k.label, k.expiringSoon]));
    expect(byLabel.soon).toBe(true);
    expect(byLabel.far).toBe(false);
  });

  it('round-trips an explicit segment + game allowlist scope', () => {
    const { plaintext } = createKey({
      label: 'scoped',
      workspace: 'prod',
      segmentIds: ['seg-1', 'seg-2'],
      gameIds: ['cfm_vn'],
      createdBy: 'admin@vng.com.vn',
    });
    const scope = verifyKey(plaintext)!;
    expect(scope.segmentIds).toEqual(['seg-1', 'seg-2']);
    expect(scope.gameIds).toEqual(['cfm_vn']);
  });
});

describe('canKeyAccessSegment scope boundary', () => {
  const base = { id: 'key', role: 'export-reader' };

  it('allows when workspace matches and allowlists are null (all)', () => {
    const scope = { ...base, workspace: 'prod', segmentIds: null, gameIds: null };
    expect(canKeyAccessSegment(scope, { id: 's1', workspace: 'prod', game_id: 'cfm_vn' })).toBe(true);
  });

  it('denies a cross-workspace segment', () => {
    const scope = { ...base, workspace: 'prod', segmentIds: null, gameIds: null };
    expect(canKeyAccessSegment(scope, { id: 's1', workspace: 'local', game_id: 'cfm_vn' })).toBe(false);
  });

  it('enforces the segment allowlist', () => {
    const scope = { ...base, workspace: 'prod', segmentIds: ['s1'], gameIds: null };
    expect(canKeyAccessSegment(scope, { id: 's1', workspace: 'prod', game_id: 'cfm_vn' })).toBe(true);
    expect(canKeyAccessSegment(scope, { id: 's2', workspace: 'prod', game_id: 'cfm_vn' })).toBe(false);
  });

  it('enforces the game allowlist', () => {
    const scope = { ...base, workspace: 'prod', segmentIds: null, gameIds: ['cfm_vn'] };
    expect(canKeyAccessSegment(scope, { id: 's1', workspace: 'prod', game_id: 'cfm_vn' })).toBe(true);
    expect(canKeyAccessSegment(scope, { id: 's1', workspace: 'prod', game_id: 'jus_vn' })).toBe(false);
  });

  it('fails closed on a missing workspace field', () => {
    const scope = { ...base, workspace: 'prod', segmentIds: null, gameIds: null };
    expect(canKeyAccessSegment(scope, { id: 's1', game_id: 'cfm_vn' })).toBe(false);
  });
});
