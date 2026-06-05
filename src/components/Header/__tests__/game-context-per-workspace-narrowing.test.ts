/**
 * Per-workspace game grant narrowing for the game picker.
 *
 * The GameContextProvider's visibleGames memo narrows the full game list to
 * only the games the user is granted IN THE ACTIVE WORKSPACE. These tests
 * verify the narrowing logic directly as a pure function extracted from the
 * memo — covering the three cases the spec requires:
 *   1. Real-auth user with grants in active workspace → only granted games shown
 *   2. Real-auth user with empty grant in active workspace → no games shown (fail-closed)
 *   3. AUTH_DISABLED (isRealAuth=false) → all games shown regardless of grants
 *   4. Real-auth admin → all games shown (admins manage the grant rows; gating
 *      them on those rows would strand a fresh admin with no picker)
 *
 * Note: the full GameContextProvider is NOT rendered here because it requires
 * stubbing gamesClient.list(), fetch('/api/workspaces'), readiness fetch, and
 * localStorage prefs — that integration is covered by the workspace-context
 * auth-fetch test. This file stays a deterministic pure-logic unit.
 */

import { describe, it, expect } from 'vitest';
import type { AuthUser } from '../../../auth/auth-context';
import { narrowGamesByWorkspaceGrant } from '../use-game-context';

interface GameDef { id: string; name: string; mark?: string }

// Exercise the REAL narrowing exported from use-game-context (the same function
// the GameContextProvider memo calls) so this guards the live picker logic.
const applyGrantNarrowing = narrowGamesByWorkspaceGrant<GameDef>;

const allGames: GameDef[] = [
  { id: 'ballistar', name: 'Ballistar' },
  { id: 'cfm_vn',   name: 'CFM VN' },
  { id: 'ptg',      name: 'PTG' },
  { id: 'cros',     name: 'CROS' },
];

// ── real-auth scenarios ──────────────────────────────────────────────────────

describe('per-workspace grant narrowing (real-auth)', () => {
  it('shows only games granted in the active workspace', () => {
    const user: AuthUser = {
      id: 'u', username: 'u', role: 'editor',
      gamesByWorkspace: { local: ['ballistar', 'cfm_vn'] },
    };
    const visible = applyGrantNarrowing(allGames, true, 'local', user);
    expect(visible.map((g) => g.id).sort()).toEqual(['ballistar', 'cfm_vn']);
  });

  it('excludes a game granted in another workspace but not the active one', () => {
    // ptg is only in 'prod', not 'local'.
    const user: AuthUser = {
      id: 'u', username: 'u', role: 'editor',
      gamesByWorkspace: { local: ['ballistar'], prod: ['ballistar', 'ptg'] },
    };
    const visible = applyGrantNarrowing(allGames, true, 'local', user);
    const ids = visible.map((g) => g.id);
    expect(ids).toContain('ballistar');
    expect(ids).not.toContain('ptg');
  });

  it('returns empty list when active workspace has no grants (fail-closed)', () => {
    const user: AuthUser = {
      id: 'u', username: 'u', role: 'editor',
      gamesByWorkspace: { prod: ['ballistar'] }, // no 'local' grants
    };
    const visible = applyGrantNarrowing(allGames, true, 'local', user);
    expect(visible).toHaveLength(0);
  });

  it('returns empty list when gamesByWorkspace is an empty record', () => {
    const user: AuthUser = { id: 'u', username: 'u', role: 'editor', gamesByWorkspace: {} };
    const visible = applyGrantNarrowing(allGames, true, 'local', user);
    expect(visible).toHaveLength(0);
  });

  it('returns empty list when gamesByWorkspace is absent (undefined)', () => {
    // Older /me payloads may omit the field entirely.
    const user: AuthUser = { id: 'u', username: 'u', role: 'editor' };
    const visible = applyGrantNarrowing(allGames, true, 'local', user);
    expect(visible).toHaveLength(0);
  });
});

// ── admin bypass ─────────────────────────────────────────────────────────────

describe('per-workspace grant narrowing (admin bypass)', () => {
  it('shows all games for a real-auth admin with no grant rows', () => {
    // A fresh admin administers grants but has none of their own — bypass keeps
    // the picker alive (mirrors the server's userCanAccessGame admin bypass).
    const user: AuthUser = { id: 'a', username: 'a', role: 'admin', gamesByWorkspace: {} };
    const visible = applyGrantNarrowing(allGames, true, 'local', user);
    expect(visible).toHaveLength(allGames.length);
  });

  it('shows all games for an admin even with a partial grant row present', () => {
    const user: AuthUser = {
      id: 'a', username: 'a', role: 'admin',
      gamesByWorkspace: { local: ['ballistar'] },
    };
    const visible = applyGrantNarrowing(allGames, true, 'local', user);
    expect(visible).toHaveLength(allGames.length);
  });
});

// ── AUTH_DISABLED / unauthenticated scenarios ────────────────────────────────

describe('per-workspace grant narrowing (AUTH_DISABLED / dev)', () => {
  it('shows all games when isRealAuth is false (AUTH_DISABLED dev mode)', () => {
    // devUser has gamesByWorkspace populated but isRealAuth=false skips the
    // grant check entirely — the dev loop never strands the picker.
    const user: AuthUser = {
      id: 'dev', username: 'dev', role: 'admin',
      gamesByWorkspace: { local: ['ballistar'] }, // even if partial, all shown
    };
    const visible = applyGrantNarrowing(allGames, false, 'local', user);
    expect(visible).toHaveLength(allGames.length);
  });

  it('shows all games when workspaceId has not resolved yet (empty string)', () => {
    // While the workspace fetch is in-flight, workspaceId=''. The memo skips
    // narrowing so the picker doesn't flash empty on first paint.
    const user: AuthUser = {
      id: 'u', username: 'u', role: 'editor',
      gamesByWorkspace: { local: ['ballistar'] },
    };
    const visible = applyGrantNarrowing(allGames, true, '', user);
    expect(visible).toHaveLength(allGames.length);
  });
});
