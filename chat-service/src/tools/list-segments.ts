/**
 * Tool: list_segments
 * Lists segments visible to the requesting owner, filtered by game_id.
 * Maps to GET /api/segments?game_id=<game>&owner=<ownerId>.
 */

import { z } from 'zod';
import { getJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';

export const name = 'list_segments';
export const description =
  'List audience segments for a given game. Returns id, name, type, uid_count, and last refresh time.';

export const inputSchema = {
  game: z.string().min(1).describe('Game id to filter segments by, e.g. "ptg"'),
};

interface SegmentRaw {
  id: string;
  name: string;
  type: string;
  uid_count?: number;
  updated_at?: string;
  [key: string]: unknown;
}

interface TrimmedSegment {
  id: string;
  name: string;
  type: string;
  uid_count?: number;
  last_refreshed_at?: string;
}

type OkResult = { ok: true; segments: TrimmedSegment[] };
type ErrResult = { ok: false; error: 'server_error'; detail: { status: number; body: unknown } };

function trim(s: SegmentRaw): TrimmedSegment {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    ...(s.uid_count !== undefined ? { uid_count: s.uid_count } : {}),
    // server stores last refresh time as updated_at for predicate segments
    ...(s.updated_at !== undefined ? { last_refreshed_at: s.updated_at } : {}),
  };
}

export async function handler(
  args: { game: string },
  ctx: ToolContext,
): Promise<OkResult | ErrResult> {
  const params = new URLSearchParams({
    game_id: args.game,
    owner: ctx.ownerId,
  });

  try {
    const rows = await getJson<SegmentRaw[]>(`/api/segments?${params.toString()}`, ctx);
    return { ok: true, segments: (rows ?? []).map(trim) };
  } catch (err) {
    if (err instanceof ServerClientError) {
      return { ok: false, error: 'server_error', detail: { status: err.status, body: err.body } };
    }
    return { ok: false, error: 'server_error', detail: { status: 0, body: String(err) } };
  }
}
