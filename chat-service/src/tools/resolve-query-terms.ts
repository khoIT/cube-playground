/**
 * Tool: resolve_query_terms
 * Resolves natural-language terms to physical Cube members (glossary + live
 * /meta), so the agent stops hand-grepping the schema to find member names.
 * Returns ranked matches per term with kind/dataType/label/confidence.
 */

import { z } from 'zod';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { fetchOfficialGlossary } from '../nl-to-query/glossary-client.js';
import { resolveQueryTerms } from '../nl-to-query/member-resolution.js';
import type { ToolContext } from '../types.js';

export const name = 'resolve_query_terms';
export const description =
  'Resolve natural-language terms (metric, entity, filter column, time field) to physical Cube ' +
  'members. Returns ranked matches per term with member ref, kind, dataType, label, and confidence. ' +
  'Call this BEFORE building or augmenting a Cube query instead of fetching full /meta and guessing — ' +
  'e.g. resolve_query_terms({terms:["user id","days since login","revenue","recharge date"]}). ' +
  'Falls back to get_cube_meta only when a term returns no confident match.';

export const inputSchema = {
  terms: z.array(z.string().min(1)).min(1).max(20),
  /** Max matches returned per term (default 3). */
  topK: z.number().int().min(1).max(10).optional(),
};

export async function handler(
  args: { terms: string[]; topK?: number },
  ctx: ToolContext,
): Promise<unknown> {
  const [glossary, meta] = await Promise.all([
    fetchOfficialGlossary().catch(() => []),
    cubeMetaCache.getMeta(ctx.gameId, ctx.workspace),
  ]);

  const results = resolveQueryTerms(args.terms, glossary, meta, args.topK ?? 3);
  return { results };
}
