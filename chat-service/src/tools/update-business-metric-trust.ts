/**
 * Tool: update_business_metric_trust
 *
 * Thin wrapper around PATCH /api/business-metrics/:id/trust. Lets the
 * assistant promote/demote a business metric conversationally. Error
 * shapes mirror the server response so the LLM can relay them in plain
 * English instead of fabricating an explanation.
 */

import { z } from 'zod';
import { patchJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';

export const name = 'update_business_metric_trust';
export const description =
  'Promote, demote, or deprecate a business metric. Server rejects promotion ' +
  'to "certified" when the metric has unresolved Cube refs; the tool relays the ' +
  'structured error so you can explain the missing refs to the user.';

export const inputSchema = {
  id: z.string().min(1).describe('Business metric id, e.g. "roas" or "npu".'),
  trust: z
    .enum(['certified', 'draft', 'deprecated'])
    .describe('Target trust tier.'),
  note: z
    .string()
    .max(280)
    .optional()
    .describe('Short rationale appended to the audit trail (≤280 chars).'),
};

type OkResult = { ok: true; metric: unknown };
type RefsUnresolvedResult = {
  ok: false;
  error: 'REFS_UNRESOLVED';
  missingRefs: string[];
  message: string;
};
type GameUnknownResult = {
  ok: false;
  error: 'GAME_UNKNOWN';
  message: string;
};
type NotFoundResult = { ok: false; error: 'NOT_FOUND'; message: string };
type ServerErrorResult = {
  ok: false;
  error: 'server_error';
  detail: { status: number; body: unknown };
};

type ErrorBody = {
  error?: {
    code?: string;
    message?: string;
    missingRefs?: string[];
  };
};

export async function handler(
  args: { id: string; trust: 'certified' | 'draft' | 'deprecated'; note?: string },
  ctx: ToolContext,
): Promise<
  | OkResult
  | RefsUnresolvedResult
  | GameUnknownResult
  | NotFoundResult
  | ServerErrorResult
> {
  const path = ctx.gameId
    ? `/api/business-metrics/${encodeURIComponent(args.id)}/trust?game=${encodeURIComponent(ctx.gameId)}`
    : `/api/business-metrics/${encodeURIComponent(args.id)}/trust`;
  const body = {
    trust: args.trust,
    actor: ctx.ownerId || 'chat',
    ...(args.note ? { note: args.note } : {}),
  };

  try {
    const metric = await patchJson<unknown>(path, body, ctx);
    return { ok: true, metric };
  } catch (err) {
    if (err instanceof ServerClientError) {
      const body = err.body as ErrorBody;
      const code = body?.error?.code;
      const message = body?.error?.message ?? `HTTP ${err.status}`;
      if (code === 'REFS_UNRESOLVED') {
        return {
          ok: false,
          error: 'REFS_UNRESOLVED',
          missingRefs: body?.error?.missingRefs ?? [],
          message,
        };
      }
      if (code === 'GAME_UNKNOWN') {
        return { ok: false, error: 'GAME_UNKNOWN', message };
      }
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
