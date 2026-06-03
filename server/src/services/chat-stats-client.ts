/**
 * Server-side client for the chat-service admin telemetry bridge
 * (`GET /internal/stats`). Used by the activity aggregator to fuse chat usage
 * into per-user/org rollups WITHOUT the main server ever opening chat.db.
 *
 * Keys on Keycloak `sub` (= chat `owner_id`). Callers MUST resolve email→sub
 * via `user_access.kc_sub` before calling — chat.db has no email.
 *
 * Graceful degradation (admin page must never hang or 500 on a slow/down chat
 * service): an explicit timeout aborts the fetch; on ANY error OR timeout the
 * result is `null`, and the aggregator renders chat counts as null rather than
 * failing the whole request.
 */

export interface ChatUserStats {
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  by_skill: Record<string, { turns: number; input_tokens: number; output_tokens: number }>;
}

/** Per-sub stats, or null when the chat service was unreachable/slow. */
export type ChatStatsBySub = Record<string, ChatUserStats> | null;

const DEFAULT_TIMEOUT_MS = 2_000;

function chatServiceUrl(): string {
  return process.env.CHAT_SERVICE_URL ?? 'http://localhost:3005';
}

export interface FetchChatStatsOpts {
  fromMs?: number;
  toMs?: number;
  timeoutMs?: number;
  /** Test seam — override the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Bulk per-sub chat stats. Returns null (never throws) on a missing secret,
 * non-200, network error, or timeout — the caller degrades gracefully.
 */
export async function fetchChatStatsBySub(
  subs: string[],
  opts: FetchChatStatsOpts = {},
): Promise<ChatStatsBySub> {
  const uniqueSubs = Array.from(new Set(subs)).filter(Boolean);
  if (uniqueSubs.length === 0) return {};

  const secret = process.env.INTERNAL_SECRET ?? '';
  if (!secret) return null; // misconfigured → degrade, don't pretend zero

  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const params = new URLSearchParams({ subs: uniqueSubs.join(',') });
    if (opts.fromMs !== undefined) params.set('from', new Date(opts.fromMs).toISOString());
    if (opts.toMs !== undefined) params.set('to', new Date(opts.toMs).toISOString());

    const res = await doFetch(`${chatServiceUrl()}/internal/stats?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'x-internal-secret': secret },
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { stats?: Record<string, ChatUserStats> };
    return body.stats ?? {};
  } catch {
    // Network error or AbortError (timeout) → degrade to null.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
