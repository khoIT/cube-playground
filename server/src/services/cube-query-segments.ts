/**
 * Cube-level `segments` (named SQL snippets defined in the cube model, e.g.
 * `mf_users.whales`) cannot be represented in the predicate tree — its leaves
 * are member/op/values filters, while a cube segment is arbitrary SQL. They
 * therefore ride as a sidecar `segments` array inside the stored
 * cube_query_json, which the refresh job re-runs verbatim.
 *
 * Every code path that REBUILDS cube_query_json from the predicate tree
 * (segment update, drift rehydration) must re-attach the sidecar through
 * these helpers, or the cube segments are silently dropped and the next
 * refresh widens membership.
 */

/** Extract the cube-segment sidecar from a stored cube_query_json blob. */
export function parseCubeSegments(cubeQueryJson: string | null | undefined): string[] | undefined {
  if (!cubeQueryJson) return undefined;
  try {
    const parsed = JSON.parse(cubeQueryJson) as { segments?: unknown };
    if (Array.isArray(parsed.segments) && parsed.segments.every((s) => typeof s === 'string')) {
      return parsed.segments.length > 0 ? (parsed.segments as string[]) : undefined;
    }
  } catch {
    // Malformed JSON — treat as no sidecar; the caller's own parse will surface it.
  }
  return undefined;
}

/** Attach a cube-segment sidecar to a query object (omitted when empty). */
export function withCubeSegments<T extends Record<string, unknown>>(
  query: T,
  segments: string[] | null | undefined,
): T & { segments?: string[] } {
  if (!segments || segments.length === 0) return query;
  return { ...query, segments };
}
