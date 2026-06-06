/**
 * Heuristic auto-suggester for the "which dimension is the user id?" question.
 * Two passes over /meta:
 *
 *   1. PATTERN — propose the first dimension whose qualified name matches a
 *      known identity pattern (case-insensitive):
 *        *.user_id | *.uid | *.customer_id | *.player_id | *.account_id
 *   2. JOIN PROBE — cubes with no direct match (event-level etl_* tables)
 *      inherit the identity of a cube they can join to (mf_users.user_id),
 *      validated by a Cube /sql dry compile. See identity-join-probe.ts.
 *
 * Returns one entry per cube. Cubes that fail both passes get
 * { identity_field: null, confidence: 0 } so the FE can render an empty state.
 */

import { getMeta, getMetaWithCtx, type WorkspaceCtx } from './cube-client.js';
import { probeJoinIdentityCached, type AnchorCube } from './identity-join-probe.js';

export interface IdentitySuggestion {
  cube: string;
  identity_field: string | null;
  confidence: number;
  matched_pattern: string | null;
}

interface CubeDimension {
  name: string;
  shortTitle?: string;
  type?: string;
}

interface CubeDescriptor {
  name: string;
  dimensions: CubeDimension[];
}

interface MetaResponse {
  cubes?: CubeDescriptor[];
}

/**
 * Patterns ordered from most specific to least specific.
 * The first match wins; confidence is the rank value.
 */
const PATTERNS: Array<{ pattern: RegExp; confidence: number; label: string }> = [
  { pattern: /\.user_id$/i,    confidence: 0.95, label: 'user_id' },
  { pattern: /\.player_id$/i,  confidence: 0.92, label: 'player_id' },
  { pattern: /\.customer_id$/i, confidence: 0.90, label: 'customer_id' },
  { pattern: /\.account_id$/i, confidence: 0.85, label: 'account_id' },
  { pattern: /\.uid$/i,         confidence: 0.80, label: 'uid' },
];

export function pickIdentityField(dims: CubeDimension[]): {
  identity_field: string | null;
  confidence: number;
  matched_pattern: string | null;
} {
  for (const { pattern, confidence, label } of PATTERNS) {
    const match = dims.find((d) => pattern.test(d.name));
    if (match) {
      return { identity_field: match.name, confidence, matched_pattern: label };
    }
  }
  return { identity_field: null, confidence: 0, matched_pattern: null };
}

export async function suggestIdentities(ctx?: WorkspaceCtx): Promise<IdentitySuggestion[]> {
  const meta = (ctx ? await getMetaWithCtx(ctx) : await getMeta()) as MetaResponse;
  const cubes = meta.cubes ?? [];
  const suggestions = cubes.map((cube) => {
    const dims = cube.dimensions ?? [];
    const picked = pickIdentityField(dims);
    return {
      cube: cube.name,
      identity_field: picked.identity_field,
      confidence: picked.confidence,
      matched_pattern: picked.matched_pattern,
    };
  });

  // Pass 2 — join-probe inheritance. Anchors are the cubes the pattern pass
  // resolved; identity-less cubes try to compile a query joining themselves
  // to an anchor's identity dim. TTL-cached per (endpoint, token, cube) so
  // the per-request cost after the first fill is zero.
  const anchors: AnchorCube[] = suggestions
    .filter((s) => s.identity_field != null)
    .map((s) => ({ cube: s.cube, identityField: s.identity_field!, confidence: s.confidence }));
  if (anchors.length > 0) {
    await Promise.all(
      suggestions.map(async (s, i) => {
        if (s.identity_field != null) return;
        const cube = cubes[i];
        const inherited = await probeJoinIdentityCached(
          { name: cube.name, dimensions: cube.dimensions ?? [] },
          anchors,
          ctx,
        );
        if (inherited) {
          s.identity_field = inherited.identityField;
          s.confidence = inherited.confidence;
          s.matched_pattern = `join→${inherited.anchorCube}`;
        }
      }),
    );
  }
  return suggestions;
}
