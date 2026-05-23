/**
 * buildLineage — pure derivation of the lineage tree for one metric.
 *
 * Upstream:   cube FQNs referenced by `formula.numerator/denominator/ref`,
 *             parsed into `cube` (left of the dot) and `member` (right).
 * Downstream: other metrics in the registry whose formula references THIS
 *             metric's id, OR whose formula references this metric's
 *             upstream cube members.
 *
 * O(n) over the registry; safe to call on every render — memoise upstream
 * via useMemo at the consumer level.
 */

import type { BusinessMetric } from '../metrics-tab/business-metric-types';

export interface LineageRef {
  fqn: string;
  cube: string;
  member?: string;
}

export interface DownstreamRef {
  metric: BusinessMetric;
  via: string;
}

export interface Lineage {
  upstream: LineageRef[];
  downstream: DownstreamRef[];
}

function parseFqn(fqn: string): LineageRef {
  const dot = fqn.indexOf('.');
  if (dot < 0) return { fqn, cube: fqn };
  return { fqn, cube: fqn.slice(0, dot), member: fqn.slice(dot + 1) };
}

export function extractFormulaRefs(metric: BusinessMetric): string[] {
  const f = metric.formula;
  if (f.type === 'measure') return [f.ref];
  if (f.type === 'ratio') return [f.numerator, f.denominator];
  if (f.type === 'expression') return f.inputs ?? [];
  return [];
}

export function buildLineage(
  metric: BusinessMetric,
  allMetrics: BusinessMetric[],
): Lineage {
  const upstreamRefs = extractFormulaRefs(metric).map(parseFqn);

  // Deduplicate upstream by FQN.
  const seen = new Set<string>();
  const upstream: LineageRef[] = [];
  for (const ref of upstreamRefs) {
    if (seen.has(ref.fqn)) continue;
    seen.add(ref.fqn);
    upstream.push(ref);
  }

  // Downstream: any metric whose refs include any of THIS metric's refs.
  const ourRefs = new Set(upstreamRefs.map((r) => r.fqn));
  const downstream: DownstreamRef[] = [];
  for (const other of allMetrics) {
    if (other.id === metric.id) continue;
    const otherRefs = extractFormulaRefs(other);
    for (const r of otherRefs) {
      if (ourRefs.has(r)) {
        downstream.push({ metric: other, via: r });
        break;
      }
    }
  }

  return { upstream, downstream };
}
