/**
 * Tool: get_business_metric_history — phase 08.
 *
 * Read-only window onto the business-metric audit trail. Lets the agent
 * answer "who last changed the trust on X" or "show the history of N" in
 * conversation. Wraps GET /api/business-metrics/:id/history.
 */

import { z } from 'zod';
import { getJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';

export const name = 'get_business_metric_history';
export const description =
  'Return the append-only audit log for a business metric (create / update / ' +
  'trust_change rows). Newest-first; default limit 50. Pass `since` (epoch ms) ' +
  'to fetch entries newer than a timestamp.';

export const inputSchema = {
  id: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  since: z.number().int().min(0).optional(),
};

interface AuditEntry {
  id: number;
  ts: number;
  metricId: string;
  action: 'create' | 'update' | 'trust_change' | 'delete';
  oldValueJson: string | null;
  newValueJson: string | null;
  actorKind: 'user' | 'agent' | 'system';
  actorId: string | null;
  reason: string | null;
  requestId: string | null;
}

type OkResult = { ok: true; entries: AuditEntry[] };
type NotFoundResult = { ok: false; error: 'NOT_FOUND'; message: string };
type ServerErrorResult = {
  ok: false;
  error: 'server_error';
  detail: { status: number; body: unknown };
};

export async function handler(
  args: { id: string; limit?: number; since?: number },
  ctx: ToolContext,
): Promise<OkResult | NotFoundResult | ServerErrorResult> {
  const params = new URLSearchParams();
  if (args.limit) params.set('limit', String(args.limit));
  if (args.since) params.set('since', String(args.since));
  const qs = params.toString();
  const path = `/api/business-metrics/${encodeURIComponent(args.id)}/history${qs ? `?${qs}` : ''}`;

  try {
    const out = await getJson<{ entries: AuditEntry[] }>(path, ctx);
    return { ok: true, entries: out.entries };
  } catch (err) {
    if (err instanceof ServerClientError) {
      const body = err.body as { error?: { code?: string; message?: string } } | undefined;
      const code = body?.error?.code;
      const message = body?.error?.message ?? `HTTP ${err.status}`;
      if (code === 'NOT_FOUND') {
        return { ok: false, error: 'NOT_FOUND', message };
      }
      return {
        ok: false,
        error: 'server_error',
        detail: { status: err.status, body: err.body },
      };
    }
    return {
      ok: false,
      error: 'server_error',
      detail: { status: 0, body: String(err) },
    };
  }
}
