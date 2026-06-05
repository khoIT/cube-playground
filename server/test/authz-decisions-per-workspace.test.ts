/**
 * Per-workspace game-grant authorization decisions.
 *
 * Tests the fail-closed logic in userCanAccessGame:
 *   - Grant in workspace A → allow (ws-A, game); deny (ws-B, same game)
 *   - Partial grants (grants exist in some workspaces but not the target) → deny
 *   - No grants anywhere + fallback ON → allow; fallback OFF → deny
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { userCanAccessGame, grantFallbackEnabled } from '../src/auth/authz-decisions.js';
import type { AuthzSubject } from '../src/auth/authz-decisions.js';

// ── helpers ─────────────────────────────────────────────────────────────────

function subject(gamesByWorkspace: Record<string, string[]>): AuthzSubject {
  return { role: 'editor', workspaces: [], gamesByWorkspace, features: {} };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('userCanAccessGame — per-workspace fail-closed', () => {
  const prevFallback = process.env.AUTHZ_GRANT_FALLBACK;

  beforeEach(() => {
    // Start each test with fallback ON (the migration-ease default) unless
    // the individual test overrides it.
    process.env.AUTHZ_GRANT_FALLBACK = 'true';
  });

  afterEach(() => {
    if (prevFallback === undefined) delete process.env.AUTHZ_GRANT_FALLBACK;
    else process.env.AUTHZ_GRANT_FALLBACK = prevFallback;
  });

  it('grants g1 in ws-a → allows (ws-a, g1)', () => {
    const s = subject({ 'ws-a': ['g1', 'g2'] });
    expect(userCanAccessGame(s, 'ws-a', 'g1')).toBe(true);
  });

  it('grants g1 in ws-a → denies (ws-b, g1) — cross-workspace leakage blocked', () => {
    // The grant exists only in ws-a; the same game id in ws-b must NOT be allowed.
    const s = subject({ 'ws-a': ['g1'] });
    expect(userCanAccessGame(s, 'ws-b', 'g1')).toBe(false);
  });

  it('partial grants (some workspaces have grants, target workspace empty) → deny', () => {
    // ws-a has grants, but ws-b has an EMPTY list — even with fallback ON, a
    // workspace with an explicit empty list is fail-closed (the user is seeded,
    // just without games in that workspace).
    const s = subject({ 'ws-a': ['g1'], 'ws-b': [] });
    expect(userCanAccessGame(s, 'ws-b', 'g1')).toBe(false);
  });

  it('partial grants (some workspaces, target workspace absent) → deny', () => {
    // ws-a has grants; ws-b has NO entry at all. Because the user HAS grants in
    // at least one workspace, the fallback does not fire — deny.
    const s = subject({ 'ws-a': ['g1'] });
    expect(userCanAccessGame(s, 'ws-b', 'g1')).toBe(false);
  });

  it('no grants anywhere + fallback ON → allow (un-seeded user during migration)', () => {
    process.env.AUTHZ_GRANT_FALLBACK = 'true';
    const s = subject({});
    expect(grantFallbackEnabled()).toBe(true);
    expect(userCanAccessGame(s, 'ws-a', 'g1')).toBe(true);
  });

  it('no grants anywhere + fallback OFF → deny (fully fail-closed post-migration)', () => {
    process.env.AUTHZ_GRANT_FALLBACK = 'false';
    const s = subject({});
    expect(grantFallbackEnabled()).toBe(false);
    expect(userCanAccessGame(s, 'ws-a', 'g1')).toBe(false);
  });

  it('a non-empty grant in the target workspace allows a granted game', () => {
    const s = subject({ 'prod': ['cfm_vn', 'ballistar'] });
    expect(userCanAccessGame(s, 'prod', 'cfm_vn')).toBe(true);
    expect(userCanAccessGame(s, 'prod', 'ballistar')).toBe(true);
  });

  it('a non-empty grant in the target workspace denies an absent game', () => {
    const s = subject({ 'prod': ['cfm_vn'] });
    expect(userCanAccessGame(s, 'prod', 'ballistar')).toBe(false);
  });

  it('admin bypasses grant checks — no rows, partial rows, fallback OFF', () => {
    // Admins administer the grant rows; gating them on those rows would lock
    // the grantor out (a fresh admin has no rows). Bypass must hold regardless
    // of fallback state or whatever partial rows exist.
    process.env.AUTHZ_GRANT_FALLBACK = 'false';
    const admin = (g: Record<string, string[]>): AuthzSubject => ({
      role: 'admin', workspaces: [], gamesByWorkspace: g, features: {},
    });
    expect(userCanAccessGame(admin({}), 'ws-a', 'g1')).toBe(true);
    expect(userCanAccessGame(admin({ 'ws-a': ['g2'] }), 'ws-a', 'g1')).toBe(true);
    expect(userCanAccessGame(admin({ 'ws-a': ['g1'] }), 'ws-b', 'g1')).toBe(true);
  });
});
