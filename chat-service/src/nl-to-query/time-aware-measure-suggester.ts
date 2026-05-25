/**
 * When the user picked a measure on a snapshot cube (no time dimension)
 * but the timeRange slot is set, suggest a similarly-named measure on a
 * time-aware cube as a replacement.
 *
 * Strategy: rank every measure on a time-aware cube by token overlap with
 * the rejected measure's name (or shortTitle), return the top N candidates.
 * Token overlap is preferred to Levenshtein because measure names tend to
 * be composed of meaningful word stems ('revenue', 'arpu', 'recharge').
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CubeMeasure {
  name: string;
  shortTitle?: string;
  title?: string;
}

interface CubeMetaCube {
  name: string;
  measures?: CubeMeasure[];
  dimensions?: Array<{ name: string; type?: string }>;
}

export interface MeasureSuggestion {
  ref: string;
  label: string;
  score: number;
}

// Currency/unit tokens carry no semantic identity — they tie unrelated
// measures together (every revenue measure ends in `_vnd`). Excluding them
// lets the matcher rank by the meaningful stem (`arpu`, `revenue`, etc).
const STOP_TOKENS = new Set([
  'the', 'of', 'in', 'a', 'an', 'and', 'or', 'per',
  'vnd', 'usd', 'eur', 'jpy', 'krw',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .split(/[_.]+/)
    .filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
}

function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  let hits = 0;
  for (const tok of b) if (setA.has(tok)) hits += 1;
  return hits / Math.max(a.length, b.length);
}

function cubeIsTimeAware(cube: CubeMetaCube): boolean {
  return (cube.dimensions ?? []).some((d) => d.type === 'time');
}

/**
 * Find time-aware measures that look like `rejectedRef`. Returns up to
 * `topN` candidates ordered by overlap score (descending). Returns an
 * empty array if nothing qualifies — caller falls back to "drop the time
 * scope, or pick something else".
 */
export function suggestTimeAwareAlternatives(
  meta: any,
  rejectedRef: string,
  rejectedTitle?: string,
  topN: number = 3,
): MeasureSuggestion[] {
  const cubes: CubeMetaCube[] = meta?.cubes ?? [];
  const rejectedTokens = tokenize(`${rejectedRef} ${rejectedTitle ?? ''}`);
  if (rejectedTokens.length === 0) return [];

  const candidates: MeasureSuggestion[] = [];
  for (const cube of cubes) {
    if (!cubeIsTimeAware(cube)) continue;
    for (const m of cube.measures ?? []) {
      const tokens = tokenize(`${m.name} ${m.shortTitle ?? ''} ${m.title ?? ''}`);
      const score = overlap(rejectedTokens, tokens);
      if (score <= 0) continue;
      candidates.push({
        ref: m.name,
        label: m.shortTitle ?? m.title ?? m.name,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, topN);
}
