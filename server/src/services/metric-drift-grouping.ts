/**
 * Root-cause grouping for metric drift.
 *
 * Collapses a flat `UnresolvedRef[]` into buckets keyed by the underlying
 * missing thing, so the UI shows "cube `funnel` is missing — affects 30
 * metrics" instead of 30 separate broken-ref rows.
 *
 *   - `cube-missing`   → grouped by cube name (the `key`); one missing cube can
 *                        break many refs across many metrics.
 *   - `member-missing` → grouped by the full ref (`cube.member`); a renamed or
 *                        removed measure is a distinct root cause per member.
 *   - `unparseable`    → per-ref (rare; each is a distinct YAML typo).
 *
 * Pure: no I/O. The validator already attributes each ref to its metric id.
 */

import { parseFqn, type UnresolvedRef } from './metric-ref-validator.js';

export type RootCauseKind = UnresolvedRef['reason'];

export interface DriftItem {
  metricId: string;
  ref: string;
}

export interface RootCauseGroup {
  kind: RootCauseKind;
  /** Cube name for `cube-missing`; full ref for `member-missing`/`unparseable`. */
  key: string;
  reason: RootCauseKind;
  affectedMetricIds: string[];
  affectedCount: number;
  refs: string[];
  /** (metricId, ref) pairs — needed to repoint a specific metric's slot. */
  items: DriftItem[];
}

function groupKey(u: UnresolvedRef): string {
  if (u.reason === 'cube-missing') {
    const parsed = parseFqn(u.ref);
    // cube-missing always parses (it passed parseFqn in the validator), but
    // fall back to the raw ref defensively.
    return parsed ? parsed.cube : u.ref;
  }
  return u.ref;
}

/**
 * Group unresolved refs by root cause. Output is stable-sorted by kind then
 * key so renders and tests are deterministic. Metric ids within a group are
 * de-duplicated (a metric referencing the same missing cube twice counts once).
 */
export function groupDriftByRootCause(refs: UnresolvedRef[]): RootCauseGroup[] {
  const byKey = new Map<string, RootCauseGroup>();
  for (const u of refs) {
    const key = groupKey(u);
    const mapKey = `${u.reason}::${key}`;
    let group = byKey.get(mapKey);
    if (!group) {
      group = {
        kind: u.reason,
        key,
        reason: u.reason,
        affectedMetricIds: [],
        affectedCount: 0,
        refs: [],
        items: [],
      };
      byKey.set(mapKey, group);
    }
    if (!group.affectedMetricIds.includes(u.metricId)) {
      group.affectedMetricIds.push(u.metricId);
    }
    if (!group.refs.includes(u.ref)) group.refs.push(u.ref);
    if (!group.items.some((it) => it.metricId === u.metricId && it.ref === u.ref)) {
      group.items.push({ metricId: u.metricId, ref: u.ref });
    }
  }

  const order: Record<RootCauseKind, number> = {
    'cube-missing': 0,
    'member-missing': 1,
    unparseable: 2,
  };
  return [...byKey.values()]
    .map((g) => ({ ...g, affectedCount: g.affectedMetricIds.length }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.key.localeCompare(b.key));
}
