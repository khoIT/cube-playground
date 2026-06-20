/**
 * Summarize what changed between two CubeQuery shapes (prior → refined), for the
 * "applied" line under a refined query card. Pure + shape-tolerant: the input is
 * the agent's re-emitted query, which may reorder arrays, so comparisons are
 * set-based for measures/dimensions and value-based for grain/range.
 */

export interface QueryDiffPart {
  kind: 'dimension' | 'grain' | 'range' | 'measure';
  text: string;
}

interface CubeQueryish {
  measures?: unknown;
  dimensions?: unknown;
  timeDimensions?: Array<{ granularity?: string; dateRange?: unknown }>;
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).map(String) : [];
}

function shortName(member: string): string {
  const tail = member.includes('.') ? member.slice(member.indexOf('.') + 1) : member;
  return tail.replace(/_/g, ' ');
}

function added(prev: string[], next: string[]): string[] {
  const before = new Set(prev);
  return next.filter((x) => !before.has(x));
}

function rangeLabel(td: CubeQueryish['timeDimensions']): string {
  const r = Array.isArray(td) ? td[0]?.dateRange : undefined;
  if (typeof r === 'string') return r;
  if (Array.isArray(r)) return r.map(String).join(' → ');
  return '';
}

/** Returns the changed parts (empty when nothing comparable changed). */
export function diffCubeQueries(prev: unknown, next: unknown): QueryDiffPart[] {
  const p = (prev && typeof prev === 'object' ? prev : {}) as CubeQueryish;
  const n = (next && typeof next === 'object' ? next : {}) as CubeQueryish;
  const parts: QueryDiffPart[] = [];

  for (const m of added(arr(p.dimensions), arr(n.dimensions))) {
    parts.push({ kind: 'dimension', text: `+ ${shortName(m)} breakdown` });
  }
  for (const m of added(arr(n.dimensions), arr(p.dimensions))) {
    parts.push({ kind: 'dimension', text: `− ${shortName(m)} breakdown` });
  }
  for (const m of added(arr(p.measures), arr(n.measures))) {
    parts.push({ kind: 'measure', text: `+ ${shortName(m)}` });
  }

  const pg = p.timeDimensions?.[0]?.granularity;
  const ng = n.timeDimensions?.[0]?.granularity;
  if (pg !== ng && (pg || ng)) {
    parts.push({ kind: 'grain', text: `grain ${pg ?? 'none'} → ${ng ?? 'none'}` });
  }

  const pr = rangeLabel(p.timeDimensions);
  const nr = rangeLabel(n.timeDimensions);
  if (pr !== nr && (pr || nr)) {
    parts.push({ kind: 'range', text: `range ${pr || 'default'} → ${nr || 'default'}` });
  }

  return parts;
}

/** One-line summary; "no structural change" when nothing comparable moved. */
export function summarizeQueryDiff(prev: unknown, next: unknown): string {
  const parts = diffCubeQueries(prev, next);
  return parts.length === 0 ? 'no structural change' : parts.map((d) => d.text).join(' · ');
}
