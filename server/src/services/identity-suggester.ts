/**
 * Heuristic auto-suggester for the "which dimension is the user id?" question.
 * Walks every cube in /meta and proposes the first dimension whose qualified
 * name matches a known identity pattern (case-insensitive):
 *   *.user_id | *.uid | *.customer_id | *.player_id | *.account_id
 *
 * Returns one entry per cube. Cubes with no matching dim get
 * { identity_field: null, confidence: 0 } so the FE can render an empty state.
 */

import { getMeta } from './cube-client.js';

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

export async function suggestIdentities(): Promise<IdentitySuggestion[]> {
  const meta = (await getMeta()) as MetaResponse;
  const cubes = meta.cubes ?? [];
  return cubes.map((cube) => {
    const dims = cube.dimensions ?? [];
    const picked = pickIdentityField(dims);
    return {
      cube: cube.name,
      identity_field: picked.identity_field,
      confidence: picked.confidence,
      matched_pattern: picked.matched_pattern,
    };
  });
}
