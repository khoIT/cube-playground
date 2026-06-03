/**
 * Fetch helpers and pure mappers for the cross-user admin chat audit panel.
 *
 * All routes require ?email=<targetEmail> — the server resolves the email to
 * a Keycloak sub and proxies to the chat-service with the TARGET user's identity.
 * Omitting email yields a 400; an unknown email yields a 404. Both are surfaced
 * as thrown errors so the panel can render an inline error state.
 *
 * Uses apiFetch (same as use-admin-access) so the Bearer JWT is attached
 * automatically. These admin audit routes sit behind requireRole('admin') +
 * requireFeature('admin') — bare fetch returns 401 in real-auth (prod) mode.
 */

import { apiFetch } from '../../../api/api-client';
import type { DebugSession, DebugSessionDetail } from '../../DevAudit/use-debug-api-types';

// ---------------------------------------------------------------------------
// Re-export types callers need — one import path from the panel
// ---------------------------------------------------------------------------

export type { DebugSession, DebugSessionDetail } from '../../DevAudit/use-debug-api-types';
export type { DebugTurn } from '../../DevAudit/use-debug-api-types';

// ---------------------------------------------------------------------------
// Internal fetch primitive
// ---------------------------------------------------------------------------

// Thin wrapper so callers stay URL-only; error parsing is handled by apiFetch
// (throws SegmentApiError on non-2xx, including 401 with force-logout).
async function adminAuditFetch<T>(url: string): Promise<T> {
  return apiFetch<T>(url);
}

// ---------------------------------------------------------------------------
// Sessions list
// ---------------------------------------------------------------------------

export interface FetchSessionsOptions {
  email: string;
  game?: string;
  q?: string;
  limit?: number;
}

/**
 * Fetches the target user's debug sessions via the cross-user admin route.
 * Always carries ?email= — required by the server authorization boundary.
 */
export async function fetchAdminChatSessions(opts: FetchSessionsOptions): Promise<DebugSession[]> {
  const params = new URLSearchParams({ email: opts.email });
  if (opts.game) params.set('game', opts.game);
  if (opts.q) params.set('q', opts.q);
  if (opts.limit != null) params.set('limit', String(opts.limit));
  return adminAuditFetch<DebugSession[]>(`/api/admin/chat/sessions?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Session detail (session meta + turns)
// ---------------------------------------------------------------------------

/**
 * Fetches a single session detail for the target user.
 * Always carries ?email= to maintain the cross-user authorization boundary.
 */
export async function fetchAdminChatSessionDetail(
  sessionId: string,
  email: string,
): Promise<DebugSessionDetail> {
  const params = new URLSearchParams({ email });
  return adminAuditFetch<DebugSessionDetail>(
    `/api/admin/chat/sessions/${encodeURIComponent(sessionId)}?${params.toString()}`,
  );
}

// ---------------------------------------------------------------------------
// Pure display mappers
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable title for a session.
 * Falls back to a truncated ID when title is absent (common for auto-created sessions).
 */
export function sessionDisplayTitle(session: DebugSession): string {
  if (session.title && session.title.trim()) return session.title.trim();
  return `Session ${session.id.slice(0, 8)}`;
}

/**
 * Formats an epoch-ms timestamp as a locale date-time string.
 * Returns "—" when the value is null/undefined.
 */
export function formatEpochMs(epochMs: number | null | undefined): string {
  if (epochMs == null) return '—';
  return new Date(epochMs).toLocaleString();
}
