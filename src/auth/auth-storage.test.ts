/**
 * Tests for cubeProxyAuthorization — the Authorization value the Cube SDK sends
 * to the workspace proxy. Must prefer the app JWT (so query telemetry attributes
 * to the logged-in user) and fall back to the Cube token when no JWT exists.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cubeProxyAuthorization, writeAppToken, clearAppToken } from './auth-storage';

describe('cubeProxyAuthorization', () => {
  beforeEach(() => {
    clearAppToken();
    vi.restoreAllMocks();
  });

  it('prefers the app JWT as a Bearer token', () => {
    writeAppToken('jwt-abc');
    expect(cubeProxyAuthorization('cube-tok')).toBe('Bearer jwt-abc');
  });

  it('falls back to the Cube token when no app JWT is stored', () => {
    expect(cubeProxyAuthorization('cube-tok')).toBe('cube-tok');
  });

  it('returns empty string when neither is present', () => {
    expect(cubeProxyAuthorization(null)).toBe('');
    expect(cubeProxyAuthorization(undefined)).toBe('');
  });
});
