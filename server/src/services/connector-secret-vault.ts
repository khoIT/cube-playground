/**
 * Connector secret vault — AES-256-GCM encryption for connector credentials at
 * rest. The ONLY module that handles connector secret material in cleartext on
 * the way in/out of the DB.
 *
 * Key: CONNECTOR_SECRET_KEY, a 32-byte key encoded base64 (44 chars) or hex (64
 * chars). Resolved lazily (not at import) so tests can set it per-suite. Absent
 * key => fail-closed: encryption throws, so DB-backed connectors can't be created
 * or read. The config-seed bootstrap path (plaintext env/file) is unaffected and
 * keeps the playground usable without a key.
 *
 * GCM gives us authenticated encryption: a tampered ciphertext/tag fails to
 * decrypt rather than returning garbage. IV is random per-encrypt (12 bytes,
 * the GCM standard) and stored alongside the ciphertext.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface SealedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

let cachedKey: Buffer | null = null;

/** Resolve + validate the 32-byte key from CONNECTOR_SECRET_KEY (base64 or hex). */
function resolveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.CONNECTOR_SECRET_KEY;
  if (!raw) {
    throw new Error(
      'CONNECTOR_SECRET_KEY is not set — cannot encrypt/decrypt connector secrets. ' +
        'Set a 32-byte base64 or hex key, or use the config-seed connector path instead.',
    );
  }
  // hex if 64 hex chars, else try base64.
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CONNECTOR_SECRET_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        'Use 32 bytes encoded as base64 (44 chars) or hex (64 chars).',
    );
  }
  cachedKey = key;
  return key;
}

/** True when a usable key is configured (cheap guard for callers / boot check). */
export function isVaultConfigured(): boolean {
  try {
    resolveKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt plaintext → sealed secret. Throws if the key is missing/invalid. */
export function sealSecret(plaintext: string): SealedSecret {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/** Decrypt a sealed secret → plaintext. Throws on missing key or tampering. */
export function openSecret(sealed: SealedSecret): string {
  const key = resolveKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/** Test-only key-cache reset (key env may change between suites). */
export function __resetVaultKeyCache(): void {
  cachedKey = null;
}
