/**
 * Typed client for the admin API-key management endpoints.
 * One method per endpoint. All calls go through apiFetch which attaches
 * auth/workspace headers and parses { error: { code, message } } envelopes.
 *
 * Endpoints (admin app-JWT, gated by requireRole('admin')):
 *   GET    /api/admin/api-keys               → { keys: ApiKeyListItem[] }
 *   POST   /api/admin/api-keys               → 201 { key: ApiKeyListItem, plaintext: string }
 *   DELETE /api/admin/api-keys/:id           → { revoked: true }
 *   GET    /api/admin/api-keys/audit?limit=N → { audit: PullAuditItem[] }
 */

import { apiFetch } from './api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One managed API key row as returned by the list + create endpoints. */
export interface ApiKeyListItem {
  id: string;
  keyPrefix: string;
  label: string;
  workspace: string;
  /** Null means the key has access to all segments in the workspace. */
  segmentIds: string[] | null;
  /** Null means the key has access to all games in the workspace. */
  gameIds: string[] | null;
  role: string;
  createdBy: string;
  createdAt: string;
  /** Set when the key has been revoked; null if still active. */
  revokedAt: string | null;
  /** ISO timestamp of expiry; null if non-expiring. */
  expiresAt: string | null;
  /** ISO timestamp of the most recent successful pull; null if never used. */
  lastUsedAt: string | null;
  /** Derived lifecycle state from the server. */
  status: 'active' | 'revoked' | 'expired';
  /** Active but within the expiring-soon window — UI should flag a renewal. */
  expiringSoon: boolean;
  /** Whether the plaintext can be re-revealed (false for pre-retrieval keys). */
  recoverable: boolean;
}

/** One row from the pull-audit log (`GET /api/admin/api-keys/audit`). */
export interface PullAuditItem {
  id: string;
  keyId: string;
  segmentId: string;
  startedAt: string;
  /** Null when the pull is still in progress or the record was not finalized. */
  finishedAt: string | null;
  rowsStreamed: number;
  source: string | null;
  format: string | null;
  status: string;
  clientIp: string | null;
}

/** Input for creating a new API key. */
export interface CreateApiKeyInput {
  label: string;
  workspace: string;
  /** Null or absent = all segments. */
  segmentIds?: string[] | null;
  /** Null or absent = all games. */
  gameIds?: string[] | null;
  /** ISO timestamp; null or absent = non-expiring. */
  expiresAt?: string | null;
}

// ---------------------------------------------------------------------------
// Client object
// ---------------------------------------------------------------------------

export const apiKeysClient = {
  /** List all API keys (active + revoked/expired) for the org. */
  list(): Promise<{ keys: ApiKeyListItem[] }> {
    return apiFetch<{ keys: ApiKeyListItem[] }>('/api/admin/api-keys');
  },

  /**
   * Create a new API key. `plaintext` is the raw secret; it can also be
   * re-revealed later via `reveal()` (the secret is stored recoverably).
   */
  create(input: CreateApiKeyInput): Promise<{ key: ApiKeyListItem; plaintext: string }> {
    return apiFetch<{ key: ApiKeyListItem; plaintext: string }>('/api/admin/api-keys', {
      method: 'POST',
      body: input,
    });
  },

  /** Reveal a key's plaintext on demand (recoverable storage). */
  reveal(id: string): Promise<{ plaintext: string }> {
    return apiFetch<{ plaintext: string }>(`/api/admin/api-keys/${encodeURIComponent(id)}/reveal`);
  },

  /** Extend / renew (or clear) a key's expiry. `expiresAt` null = non-expiring. */
  updateExpiry(id: string, expiresAt: string | null): Promise<{ updated: true }> {
    return apiFetch<{ updated: true }>(`/api/admin/api-keys/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { expiresAt },
    });
  },

  /** Revoke an API key by id. Returns { revoked: true } on success. */
  revoke(id: string): Promise<{ revoked: true }> {
    return apiFetch<{ revoked: true }>(`/api/admin/api-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  /**
   * Fetch recent pull-audit rows across all keys.
   * @param limit Max rows to return (server cap: 200).
   */
  audit(limit = 100): Promise<{ audit: PullAuditItem[] }> {
    return apiFetch<{ audit: PullAuditItem[] }>('/api/admin/api-keys/audit', {
      query: { limit },
    });
  },
};
