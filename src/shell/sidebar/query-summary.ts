/**
 * Playground query → recent-tray helpers.
 *
 * - summarizeQuery: short label of the active measures/dimensions so the user
 *   can recognise a query at a glance in the sidebar tray.
 * - fingerprintQuery: stable short id for dedupe across runs (canonical JSON
 *   hashed with djb2). Different ordering of keys/array members must NOT
 *   produce different ids — otherwise the tray would fill with duplicates of
 *   the same logical query as react-router rewrites the URL.
 */
export type PlaygroundQuery = {
  measures?: string[];
  dimensions?: string[];
  timeDimensions?: Array<{
    dimension: string;
    granularity?: string;
    dateRange?: unknown;
  }>;
  filters?: unknown[];
  segments?: string[];
  order?: unknown;
  limit?: number;
};

/** "Orders.count" → "count", "Orders.createdAt" → "createdAt". The cube name
 *  eats horizontal room in the narrow sidebar without adding much signal — the
 *  member name alone is enough to recognise the query at a glance. */
function shortMember(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i >= 0 ? fqn.slice(i + 1) : fqn;
}

/**
 * Build a compact label like:
 *   "Q1: count × country"
 *   "Q2: count × createdAt:day"
 *   "Q3: country" (no measures)
 *   "Q4: count" (no dimensions)
 *
 * Returns `null` for queries with no measures and no dimensions — the caller
 * uses this to skip pushing empty/placeholder queries into the tray.
 *
 * Only the FIRST measure and FIRST dimension are shown so the row stays
 * recognizable in the narrow sidebar even after CSS ellipsis kicks in.
 */
export function summarizeQuery(
  q: PlaygroundQuery | null | undefined,
  num: number,
): string | null {
  if (!q) return null;
  const measure = (q.measures ?? [])[0];
  const dim = (q.dimensions ?? [])[0];
  const td = (q.timeDimensions ?? []).find((t) => t && typeof t.dimension === 'string');
  const tdLabel = td
    ? (td.granularity ? `${shortMember(td.dimension)}:${td.granularity}` : shortMember(td.dimension))
    : undefined;
  const firstDim = dim ? shortMember(dim) : tdLabel;
  const firstMeasure = measure ? shortMember(measure) : undefined;

  if (!firstMeasure && !firstDim) return null;

  const prefix = `Q${num}:`;
  if (firstMeasure && firstDim) return `${prefix} ${firstMeasure} × ${firstDim}`;
  return `${prefix} ${firstMeasure ?? firstDim}`;
}


/** djb2 hash → base36 string. Cheap, stable, collision rate fine for an
 *  8-slot LRU keyed per game. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(36);
}

/** Sorted-key JSON so { a:1, b:2 } and { b:2, a:1 } hash to the same id. */
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

export function fingerprintQuery(q: PlaygroundQuery): string {
  return djb2(canonicalJson(q));
}
