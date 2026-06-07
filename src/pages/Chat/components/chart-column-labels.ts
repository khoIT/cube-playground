/**
 * chart-column-labels — resolve a chart/table column key (a Cube member ref
 * such as "mf_users.ltv_total_vnd") to a human label.
 *
 * Labels come from the server-resolved `ChartColumn[]` descriptor (meta
 * shortTitle/title). When a column has no descriptor (older artifacts,
 * assistant-derived rollups) we humanise the member leaf so the UI never
 * surfaces a raw "cube.member" key.
 */
import type { ChartColumn } from '../../../api/chat-sse-client';

export type LabelMap = Record<string, string>;

export function buildLabelMap(columns?: ChartColumn[]): LabelMap {
  const map: LabelMap = {};
  for (const c of columns ?? []) map[c.key] = c.label;
  return map;
}

/** "mf_users.ltv_total_vnd" → "Ltv total vnd". */
function humaniseMember(key: string): string {
  const leaf = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
  const words = leaf.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/**
 * Accepts string | number because recharts tooltip/legend callbacks don't
 * always hand back a column key: Funnel items, for example, name entries from
 * `nameKey` and fall back to the numeric row index when that's absent.
 */
export function labelOf(labels: LabelMap, key: string | number): string {
  const k = String(key);
  return labels[k] ?? humaniseMember(k);
}
