/**
 * Service-to-service API-key store for the public segment-export surface.
 *
 * DB-authoritative (the `api_keys` table) behind a short TTL cache keyed by the
 * sha256 of the presented key — so the hot verify path on a long stream doesn't
 * hit SQLite on every page. Mutators (`createKey`, `revokeKey`) invalidate the
 * cache so a revoke takes effect within the TTL window at worst, immediately for
 * the revoked key itself.
 *
 * Security: the plaintext key is shown exactly ONCE at creation and never stored
 * — only sha256(key) (the lookup column) plus a short non-secret prefix crumb
 * for display. Verification hashes the presented key and matches the stored
 * hash, so the secret is never string-compared. Role is fixed read-only.
 */

import { randomBytes, createHash } from 'node:crypto';
import { getDb } from '../db/sqlite.js';

export interface ApiKeyScope {
  id: string;
  workspace: string;
  /** Segment ids this key may read; null = all segments in the workspace. */
  segmentIds: string[] | null;
  /** Game ids this key may read; null = all games. */
  gameIds: string[] | null;
  role: string;
}

export interface ApiKeyRow {
  id: string;
  key_prefix: string;
  key_sha256: string;
  label: string;
  workspace: string;
  segment_ids_json: string | null;
  game_ids_json: string | null;
  role: string;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
}

/** Public-safe view of a key (never includes the hash or plaintext). */
export interface ApiKeyListItem {
  id: string;
  keyPrefix: string;
  label: string;
  workspace: string;
  segmentIds: string[] | null;
  gameIds: string[] | null;
  role: string;
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  status: 'active' | 'revoked' | 'expired';
}

const KEY_PREFIX = 'sk_live_';
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'; // RFC 4648 lowercase, no padding.

/** Lowercase RFC-4648 base32 (no padding) of arbitrary bytes. */
function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function toScope(row: ApiKeyRow): ApiKeyScope {
  return {
    id: row.id,
    workspace: row.workspace,
    segmentIds: row.segment_ids_json ? (JSON.parse(row.segment_ids_json) as string[]) : null,
    gameIds: row.game_ids_json ? (JSON.parse(row.game_ids_json) as string[]) : null,
    role: row.role,
  };
}

// ---- TTL cache (keyed by sha256) -------------------------------------------

interface CacheEntry {
  value: ApiKeyScope | null;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

function cacheTtlMs(): number {
  const raw = Number(process.env.API_KEY_CACHE_TTL_MS ?? 30_000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
}

function invalidate(): void {
  cache.clear();
}

// ---- last_used_at throttle (avoid a write per streamed page) ---------------

const lastTouch = new Map<string, number>();
function touchIntervalMs(): number {
  const raw = Number(process.env.API_KEY_TOUCH_INTERVAL_MS ?? 60_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
}

/** Bump last_used_at at most once per interval per key (write amplification guard). */
export function touchLastUsed(keyId: string): void {
  const now = Date.now();
  const prev = lastTouch.get(keyId) ?? 0;
  if (now - prev < touchIntervalMs()) return;
  lastTouch.set(keyId, now);
  // Best-effort telemetry — never let a write hiccup fail an already-authorized
  // request (this runs inside the auth preHandler).
  try {
    getDb()
      .prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
      .run(new Date(now).toISOString(), keyId);
  } catch {
    /* swallow — last_used_at is observability, not correctness */
  }
}

// ---- Mint / verify ---------------------------------------------------------

export interface CreateKeyInput {
  label: string;
  workspace: string;
  segmentIds?: string[] | null;
  gameIds?: string[] | null;
  createdBy: string;
  expiresAt?: string | null;
}

export interface CreatedKey {
  /** Plaintext — returned ONCE, never persisted. The caller must surface it now. */
  plaintext: string;
  item: ApiKeyListItem;
}

export function createKey(input: CreateKeyInput): CreatedKey {
  const secret = base32(randomBytes(20)); // 20 bytes → 32 base32 chars.
  const plaintext = `${KEY_PREFIX}${secret}`;
  const id = `key_${base32(randomBytes(10))}`;
  const keyPrefix = `${KEY_PREFIX}${secret.slice(0, 4)}`;
  const createdAt = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO api_keys
         (id, key_prefix, key_sha256, label, workspace, segment_ids_json, game_ids_json,
          role, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'export-reader', ?, ?, ?)`,
    )
    .run(
      id,
      keyPrefix,
      sha256Hex(plaintext),
      input.label,
      input.workspace,
      input.segmentIds ? JSON.stringify(input.segmentIds) : null,
      input.gameIds ? JSON.stringify(input.gameIds) : null,
      input.createdBy,
      createdAt,
      input.expiresAt ?? null,
    );
  invalidate();
  const row = getDb().prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as ApiKeyRow;
  return { plaintext, item: toListItem(row) };
}

/**
 * Resolve a presented plaintext key to its scope, or null if unknown / revoked
 * / expired. Cached by the key's hash for the hot stream path.
 */
export function verifyKey(plaintext: string): ApiKeyScope | null {
  if (!plaintext.startsWith(KEY_PREFIX)) return null;
  const hash = sha256Hex(plaintext);

  const now = Date.now();
  const hit = cache.get(hash);
  if (hit && hit.expiresAt > now) return hit.value;

  const row = getDb()
    .prepare('SELECT * FROM api_keys WHERE key_sha256 = ?')
    .get(hash) as ApiKeyRow | undefined;

  let value: ApiKeyScope | null = null;
  if (row && !row.revoked_at && !isExpired(row.expires_at)) {
    value = toScope(row);
  }
  // Cache ONLY positive results. Caching misses keyed by the presented hash
  // would let random-token spray on the public surface grow the map unbounded;
  // a DB miss is cheap and not the hot path.
  if (value) cache.set(hash, { value, expiresAt: now + cacheTtlMs() });
  return value;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= Date.now();
}

// ---- Admin listing / revoke ------------------------------------------------

function toListItem(row: ApiKeyRow): ApiKeyListItem {
  const status: ApiKeyListItem['status'] = row.revoked_at
    ? 'revoked'
    : isExpired(row.expires_at)
      ? 'expired'
      : 'active';
  return {
    id: row.id,
    keyPrefix: row.key_prefix,
    label: row.label,
    workspace: row.workspace,
    segmentIds: row.segment_ids_json ? (JSON.parse(row.segment_ids_json) as string[]) : null,
    gameIds: row.game_ids_json ? (JSON.parse(row.game_ids_json) as string[]) : null,
    role: row.role,
    createdBy: row.created_by,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    status,
  };
}

/** All keys (admin view). No secrets — hash is never projected. */
export function listKeys(): ApiKeyListItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM api_keys ORDER BY created_at DESC')
    .all() as ApiKeyRow[];
  return rows.map(toListItem);
}

/** Revoke a key (idempotent). Returns false if the id is unknown. */
export function revokeKey(id: string): boolean {
  const res = getDb()
    .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), id);
  invalidate();
  // changes===0 can mean "already revoked" too; treat presence of the row as success.
  const exists = getDb().prepare('SELECT 1 FROM api_keys WHERE id = ?').get(id);
  return res.changes > 0 || Boolean(exists);
}

/** Test-only: clear in-process caches. */
export function __resetApiKeyCaches(): void {
  cache.clear();
  lastTouch.clear();
}
