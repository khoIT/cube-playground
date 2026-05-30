/**
 * Unit tests for the connector secret vault (AES-256-GCM). Pure crypto — no DB.
 * Key cache is reset between cases since CONNECTOR_SECRET_KEY changes per test.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import {
  sealSecret,
  openSecret,
  isVaultConfigured,
  __resetVaultKeyCache,
} from '../src/services/connector-secret-vault.js';

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');

function useKey(key: string | undefined): void {
  if (key === undefined) delete process.env.CONNECTOR_SECRET_KEY;
  else process.env.CONNECTOR_SECRET_KEY = key;
  __resetVaultKeyCache();
}

afterEach(() => useKey(undefined));

describe('connector-secret-vault', () => {
  it('round-trips a secret with the same key', () => {
    useKey(KEY_A);
    const sealed = sealSecret('hunter2-super-secret');
    expect(openSecret(sealed)).toBe('hunter2-super-secret');
  });

  it('produces ciphertext distinct from plaintext, with iv + tag', () => {
    useKey(KEY_A);
    const sealed = sealSecret('plaintext-value');
    expect(sealed.ciphertext).not.toContain('plaintext-value');
    expect(sealed.iv).toBeTruthy();
    expect(sealed.tag).toBeTruthy();
  });

  it('uses a fresh IV per encryption (non-deterministic ciphertext)', () => {
    useKey(KEY_A);
    const a = sealSecret('same-input');
    const b = sealSecret('same-input');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails to decrypt with the wrong key (GCM auth)', () => {
    useKey(KEY_A);
    const sealed = sealSecret('top-secret');
    useKey(KEY_B);
    expect(() => openSecret(sealed)).toThrow();
  });

  it('fails to decrypt tampered ciphertext', () => {
    useKey(KEY_A);
    const sealed = sealSecret('top-secret');
    const tampered = {
      ...sealed,
      ciphertext: Buffer.from('totally-different-bytes').toString('base64'),
    };
    expect(() => openSecret(tampered)).toThrow();
  });

  it('is fail-closed when the key is absent', () => {
    useKey(undefined);
    expect(isVaultConfigured()).toBe(false);
    expect(() => sealSecret('x')).toThrow(/CONNECTOR_SECRET_KEY/);
  });

  it('rejects a key of the wrong length', () => {
    useKey(Buffer.from('too-short').toString('base64'));
    expect(isVaultConfigured()).toBe(false);
    expect(() => sealSecret('x')).toThrow(/32 bytes/);
  });
});
