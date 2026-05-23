/**
 * Verify HS256 output against an independently-computed reference using
 * `node:crypto`. Tests the on-the-wire bytes, not just shape, so any drift
 * in base64url / signing input formation fails fast.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { signCubeToken } from '../src/services/sign-cube-token.js';

function b64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

describe('signCubeToken', () => {
  it('produces three base64url segments separated by dots', () => {
    const token = signCubeToken({ game: 'ptg', userId: 'playground', iat: 1700000000 }, 's3cr3t');
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('matches an independently-computed reference', () => {
    const secret = 'shared-secret';
    const payload = { game: 'ballistar', userId: 'playground', iat: 1700000123 };
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify(payload));
    const sig = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
    const expected = `${header}.${body}.${sig}`;
    expect(signCubeToken(payload, secret)).toBe(expected);
  });

  it('throws if secret is empty', () => {
    expect(() => signCubeToken({ game: 'ptg', userId: 'playground' }, '')).toThrow(/secret/);
  });

  it('auto-fills iat when omitted', () => {
    const token = signCubeToken({ game: 'ptg', userId: 'playground' }, 'k');
    const [, body] = token.split('.');
    const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
    const decoded = JSON.parse(
      Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
    expect(typeof decoded.iat).toBe('number');
    expect(decoded.iat).toBeGreaterThan(1_700_000_000);
  });
});
