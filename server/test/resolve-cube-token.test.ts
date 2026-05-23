import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveCubeTokenForGame,
  __envKeyFor,
} from '../src/services/resolve-cube-token.js';

const KEYS = ['CUBE_TOKEN', 'CUBE_TOKEN_PTG', 'CUBE_TOKEN_BALLISTAR', 'CUBE_TOKEN_CFM_VN'];

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
