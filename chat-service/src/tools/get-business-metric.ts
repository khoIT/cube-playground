/**
 * Tool: get_business_metric
 * Fetches the full YAML-derived object for a single business metric by id.
 */

import { z } from 'zod';
import { getJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';

export const name = 'get_business_metric';
export const description =
  'Fetch the full definition of a business metric by its id ' +
  '(includes formula, synonyms, related_concepts, game_compatibility, etc).';

export const inputSchema = {
  id: z.string().min(1).describe('The business metric id, e.g. "roas" or "arpu"'),
};

type OkResult = { ok: true; metric: unknown };
type NotFoundResult = { ok: false; error: 'not_found'; detail: { id: string } };
type ErrResult = { ok: false; error: 'server_error'; detail: { status: number; body: unknown } };

export async function handler(
  args: { id: string },
  ctx: ToolContext,
): Promise<OkResult | NotFoundResult | ErrResult> {
  const qs = ctx.gameId ? `?game=${encodeURIComponent(ctx.gameId)}` : '';
  try {
    const metric = await getJson<unknown>(
      `/api/business-metrics/${encodeURIComponent(args.id)}${qs}`,
      ctx,
    );
    return { ok: true, metric };
  } catch (err) {
    if (err instanceof ServerClientError) {
      if (err.status === 404) {
        return { ok: false, error: 'not_found', detail: { id: args.id } };
      }
      return { ok: false, error: 'server_error', detail: { status: err.status, body: err.body } };
    }
    return { ok: false, error: 'server_error', detail: { status: 0, body: String(err) } };
  }
}
