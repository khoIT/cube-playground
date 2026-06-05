/**
 * Tool: list_dimension_values
 * Returns the distinct values (exact casing) of a low-cardinality Cube
 * dimension, so the agent stops guessing filter-value casing (e.g. "whale" vs
 * "Whale"). Caps the result and signals truncation for high-cardinality columns.
 */

import { z } from 'zod';
import { config } from '../config.js';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { resolveMemberMeta } from '../core/cube-meta-capability.js';
import type { ToolContext } from '../types.js';

export const name = 'list_dimension_values';
export const description =
  'List the distinct values (exact casing) of a low-cardinality Cube dimension, so you can write an ' +
  'equals/contains filter without guessing casing — e.g. list_dimension_values({member:"mf_users.payer_tier"}) ' +
  '→ ["whale","dolphin",…]. Optional `q` substring-filters the values. For enums/tiers, NOT free-text columns: ' +
  'high-cardinality dimensions return a capped list with truncated=true.';

const DEFAULT_CAP = 50;

export const inputSchema = {
  member: z.string().min(1),
  /** Case-insensitive substring filter on returned values. */
  q: z.string().optional(),
  /** Max values returned (default 50). */
  limit: z.number().int().min(1).max(200).optional(),
};

export async function handler(
  args: { member: string; q?: string; limit?: number },
  ctx: ToolContext,
): Promise<unknown> {
  const cap = args.limit ?? DEFAULT_CAP;
  const meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.workspace);
  const resolved = resolveMemberMeta(meta, args.member);

  // Only dimensions/time dimensions enumerate sensibly; a measure is an
  // aggregate, not a value set. Reject with an actionable message.
  if (resolved.kind === 'measure') {
    return {
      member: args.member,
      values: [],
      truncated: false,
      count: 0,
      error: `${args.member} is a measure, not a dimension — measures have no distinct value set to filter on.`,
    };
  }

  // Dimensions-only Cube query returns distinct value combinations; one
  // dimension → its distinct values. Fetch cap+1 to detect truncation.
  const query = { dimensions: [args.member], limit: cap + 1 };
  const url = `${config.serverBaseUrl}/cube-api/v1/load`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Cube-Workspace': ctx.workspace,
      'X-Cube-Game': ctx.gameId,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cube /load failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { data?: Record<string, string | number>[] };
  const rows = data?.data ?? [];

  // Unique, defined values in result order.
  const seen = new Set<string>();
  let values: string[] = [];
  for (const row of rows) {
    const raw = row[args.member];
    if (raw === null || raw === undefined) continue;
    const v = String(raw);
    if (seen.has(v)) continue;
    seen.add(v);
    values.push(v);
  }

  // Optional case-insensitive substring filter.
  if (args.q) {
    const needle = args.q.toLowerCase();
    values = values.filter((v) => v.toLowerCase().includes(needle));
  }

  const truncated = values.length > cap;
  return {
    member: args.member,
    values: values.slice(0, cap),
    truncated,
    count: values.length > cap ? cap : values.length,
  };
}
