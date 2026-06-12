/**
 * Extract the cube-level segment sidecar (e.g. ["mf_users.whales"]) from a
 * stored cube_query_json blob, for display in slice-scope notices. Mirrors
 * server/src/services/cube-query-segments.ts — the sidecar exists because
 * cube segments are named SQL snippets the predicate tree cannot express.
 */

/**
 * Canonical sort for cube-segment arrays before persistence.
 * Sorting prevents byte-for-byte churn when the same logical set is saved
 * in different orderings (e.g. chip toggling always re-derives a full set).
 */
export function canonicallySortSegments(segments: string[]): string[] {
  return [...segments].sort();
}

export function parseCubeSegmentsFromQueryJson(
  cubeQueryJson: string | null | undefined,
): string[] {
  if (!cubeQueryJson) return [];
  try {
    const parsed = JSON.parse(cubeQueryJson) as { segments?: unknown };
    if (Array.isArray(parsed.segments)) {
      return parsed.segments.filter((s): s is string => typeof s === 'string');
    }
  } catch {
    // Malformed stored query — display-only caller renders no chips.
  }
  return [];
}
