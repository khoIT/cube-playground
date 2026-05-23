/**
 * Tool: get_segment
 * Fetches the full segment record by id, including predicate, identity dim, and sample uids.
 */

import { z } from 'zod';
import { getJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';

export const name = 'get_segment';
export const description =
  'Fetch the full definition of an audience segment by id, ' +
  'including its predicate tree, primary cube, identity dimension, and sample uids.';

export const inputSchema = {
  id: z.string().min(1).describe('Segment uuid'),
};

interface SegmentDetail {
  id: string;
  name: string;
  type: string;
  predicate_tree?: unknown;
  cube?: string | null;
  uid_count?: number;
  uid_list?: string[];
  updated_at?: string;
  [key: string]: unknown;
}

interface TrimmedSegment {
  id: string;
  name: string;
  type: string;
  predicate_json?: unknown;
  primary_cube?: string | null;
  uid_count?: number;
  sample_uids?: string[];
  last_refreshed_at?: string;
}

type OkResult = { ok: true; segment: TrimmedSegment };
type NotFoundResult = { ok: false; error: 'not_found'; detail: { id: string } };
type ErrResult = { ok: false; error: 'server_error'; detail: { status: number; body: unknown } };

function trim(s: SegmentDetail): TrimmedSegment {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    ...(s.predicate_tree !== undefined ? { predicate_json: s.predicate_tree } : {}),
    ...(s.cube !== undefined ? { primary_cube: s.cube } : {}),
    ...(s.uid_count !== undefined ? { uid_count: s.uid_count } : {}),
    // Return only first 20 sample uids to keep response token-compact
    ...(Array.isArray(s.uid_list) ? { sample_uids: s.uid_list.slice(0, 20) } : {}),
    ...(s.updated_at !== undefined ? { last_refreshed_at: s.updated_at } : {}),
  };
}

export async function handler(
  args: { id: string },
  ctx: ToolContext,
): Promise<OkResult | NotFoundResult | ErrResult> {
  try {
    const row = await getJson<SegmentDetail>(
      `/api/segments/${encodeURIComponent(args.id)}`,
      ctx,
    );
    return { ok: true, segment: trim(row) };
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
