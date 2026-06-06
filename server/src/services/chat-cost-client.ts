/**
 * Server-side client for the chat-service cost bridge
 * (`GET /internal/cost-breakdown`). Used by the admin cost route to render
 * org-wide spend tables WITHOUT the main server ever opening chat.db.
 *
 * Owner rows key on Keycloak `sub` (= chat `owner_id`); the route enriches
 * sub→email via `user_access.kc_sub` before serving the FE.
 *
 * Graceful degradation (admin page must never hang or 500 on a slow/down chat
 * service): an explicit timeout aborts the fetch; on ANY error OR timeout the
 * result is `null`, and the route serves a null breakdown rather than failing.
 */

export interface CostBucket {
  cost_usd: number;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  sessions: number;
}

export interface OwnerCostRow extends CostBucket {
  owner_id: string;
  owner_label: string | null;
}

export interface GameCostRow extends CostBucket {
  game_id: string;
}

export interface WorkspaceCostRow extends CostBucket {
  workspace: string;
}

export interface SessionCostRow {
  session_id: string;
  title: string | null;
  owner_id: string;
  owner_label: string | null;
  game_id: string;
  workspace: string;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  last_turn_at: number | null;
}

export interface CostBreakdown {
  total: CostBucket;
  by_owner: OwnerCostRow[];
  by_game: GameCostRow[];
  by_workspace: WorkspaceCostRow[];
  sessions: SessionCostRow[];
  session_total: number;
}

// Wider than the 2s stats timeout — the all-time default scans every turn row,
// which can take longer on a prod-sized chat.db.
const DEFAULT_TIMEOUT_MS = 5_000;

function chatServiceUrl(): string {
  return process.env.CHAT_SERVICE_URL ?? 'http://localhost:3005';
}

export interface FetchCostBreakdownOpts {
  /** Omit for all-time (chat-service defaults from=epoch). */
  fromMs?: number;
  toMs?: number;
  /** Top-N sessions by cost (chat-service clamps 1..500, default 100). */
  limit?: number;
  timeoutMs?: number;
  /** Test seam — override the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Org-wide cost breakdown. Returns null (never throws) on a missing secret,
 * non-200, network error, or timeout — the caller degrades gracefully.
 */
export async function fetchCostBreakdown(
  opts: FetchCostBreakdownOpts = {},
): Promise<CostBreakdown | null> {
  const secret = process.env.INTERNAL_SECRET ?? '';
  if (!secret) return null; // misconfigured → degrade, don't pretend zero

  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const params = new URLSearchParams();
    if (opts.fromMs !== undefined) params.set('from', new Date(opts.fromMs).toISOString());
    if (opts.toMs !== undefined) params.set('to', new Date(opts.toMs).toISOString());
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    const qs = params.toString();

    const res = await doFetch(`${chatServiceUrl()}/internal/cost-breakdown${qs ? `?${qs}` : ''}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'x-internal-secret': secret },
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as CostBreakdown;
  } catch {
    // Network error or AbortError (timeout) → degrade to null.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
