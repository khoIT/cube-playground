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
