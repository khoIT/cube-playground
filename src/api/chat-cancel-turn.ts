/**
 * Phase 04 — client helper for the server-side cancel endpoint.
 *
 *   POST /api/agent/turn/:turnId/cancel
 *     202 { aborted: true }                         — abort signalled
 *     410 { aborted: false, code: 'not_running' }   — race; turn already done
 *     401/403                                       — owner mismatch
 *
 * The chat-service dev server registers the route at `/agent/turn/...`; the
 * web app proxies via `/api/...` so the FE always uses the `/api` prefix.
 *
 * Defensive: network errors return `{ aborted: false, code: 'network' }` so
 * the caller renders the same "cancel didn't take" affordance without a
 * try/catch boilerplate.
 */

import { getOwnerId } from './chat-owner-id';

export interface CancelTurnResult {
  aborted: boolean;
  code?: 'not_running' | 'session_missing' | 'network' | 'forbidden';
}

export async function cancelTurn(turnId: string): Promise<CancelTurnResult> {
  try {
    const res = await fetch(`/api/agent/turn/${encodeURIComponent(turnId)}/cancel`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Owner-Id': getOwnerId(),
      },
    });
    if (res.status === 202) return { aborted: true };
    if (res.status === 410) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      const code = body.code === 'session_missing' ? 'session_missing' : 'not_running';
      return { aborted: false, code };
    }
    if (res.status === 401 || res.status === 403) {
      return { aborted: false, code: 'forbidden' };
    }
    return { aborted: false, code: 'network' };
  } catch {
    return { aborted: false, code: 'network' };
  }
}
