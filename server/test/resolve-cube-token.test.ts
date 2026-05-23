import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveCubeTokenForGame,
  resolveCubeTokenForGameDetailed,
  __envKeyFor,
} from '../src/services/resolve-cube-token.js';

const KEYS = [
  'CUBE_TOKEN',
  'CUBE_TOKEN_PTG',
  'CUBE_TOKEN_BALLISTAR',
  'CUBE_TOKEN_CFM_VN',
  'CUBEJS_API_SECRET',
  'CUBE_PLAYGROUND_USER_ID',
];

function decodeJwtPayload(token: string): Record<string, unknown> {
  const seg = token.split('.')[1];
  // base64url → base64
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json);
}

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveCubeTokenForGame', () => {
  it('returns null when neither per-game nor fallback is set', () => {
    expect(resolveCubeTokenForGame('ptg')).toBeNull();
  });

  it('returns the per-game token when set', () => {
    process.env.CUBE_TOKEN_PTG = 'ptg-token';
    process.env.CUBE_TOKEN = 'fallback';
    expect(resolveCubeTokenForGame('ptg')).toBe('ptg-token');
  });

  it('falls back to CUBE_TOKEN when no per-game token', () => {
    process.env.CUBE_TOKEN = 'fallback';
    expect(resolveCubeTokenForGame('ballistar')).toBe('fallback');
  });

  it('normalizes game id into the env-var key (dashes + case)', () => {
    expect(__envKeyFor('ptg')).toBe('CUBE_TOKEN_PTG');
    expect(__envKeyFor('cfm-vn')).toBe('CUBE_TOKEN_CFM_VN');
    expect(__envKeyFor('cfm_vn')).toBe('CUBE_TOKEN_CFM_VN');
  });
});

describe('resolveCubeTokenForGameDetailed', () => {
  it('source = env when per-game token is set', () => {
    process.env.CUBE_TOKEN_PTG = 'ptg-token';
    process.env.CUBEJS_API_SECRET = 'secret';
    const res = resolveCubeTokenForGameDetailed('ptg');
    expect(res.source).toBe('env');
    expect(res.token).toBe('ptg-token');
  });

  it('source = minted when secret is set but no per-game env', () => {
    process.env.CUBEJS_API_SECRET = 'shared-secret';
    const res = resolveCubeTokenForGameDetailed('ballistar');
    expect(res.source).toBe('minted');
    expect(res.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('source = fallback when only CUBE_TOKEN is set', () => {
    process.env.CUBE_TOKEN = 'legacy';
    const res = resolveCubeTokenForGameDetailed('jus_vn');
    expect(res.source).toBe('fallback');
    expect(res.token).toBe('legacy');
  });

  it('source = none when nothing is configured', () => {
    const res = resolveCubeTokenForGameDetailed('ptg');
    expect(res).toEqual({ token: null, source: 'none' });
  });

  it('env wins over secret', () => {
    process.env.CUBE_TOKEN_PTG = 'env-token';
    process.env.CUBEJS_API_SECRET = 'secret';
    expect(resolveCubeTokenForGameDetailed('ptg').source).toBe('env');
  });

  it('mints JWTs with distinct game claims per game (cross-tenant isolation)', () => {
    process.env.CUBEJS_API_SECRET = 'shared-secret';
    const ballistar = resolveCubeTokenForGameDetailed('ballistar');
    const ptg = resolveCubeTokenForGameDetailed('ptg');
    const cfm = resolveCubeTokenForGameDetailed('cfm_vn');

    expect(ballistar.source).toBe('minted');
    expect(ptg.source).toBe('minted');
    expect(cfm.source).toBe('minted');

    // Distinct tokens — same game would collide, which is what we're guarding
    // against (the bug where the picker swaps but every game gets the same JWT).
    expect(ballistar.token).not.toBe(ptg.token);
    expect(ptg.token).not.toBe(cfm.token);

    const ballistarClaim = decodeJwtPayload(ballistar.token!);
    const ptgClaim = decodeJwtPayload(ptg.token!);
    const cfmClaim = decodeJwtPayload(cfm.token!);

    expect(ballistarClaim.game).toBe('ballistar');
    expect(ptgClaim.game).toBe('ptg');
    // Aliases pass through unchanged — Cube canonicalizes server-side.
    expect(cfmClaim.game).toBe('cfm_vn');
  });

  it('minted JWT userId defaults to "playground"', () => {
    process.env.CUBEJS_API_SECRET = 'shared-secret';
    const res = resolveCubeTokenForGameDetailed('ptg');
    expect(decodeJwtPayload(res.token!).userId).toBe('playground');
  });

  it('minted JWT userId honors CUBE_PLAYGROUND_USER_ID override', () => {
    process.env.CUBEJS_API_SECRET = 'shared-secret';
    process.env.CUBE_PLAYGROUND_USER_ID = '9001';
    const res = resolveCubeTokenForGameDetailed('ptg');
    expect(decodeJwtPayload(res.token!).userId).toBe('9001');
  });
});
