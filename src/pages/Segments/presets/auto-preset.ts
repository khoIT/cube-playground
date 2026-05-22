/**
 * Auto-preset synthesizer.
 *
 * When a segment's cube has no curated preset, we still want the detail view
 * to show *something* — KPIs and at least one Overview tab so the UX is
 * consistent across all cubes (past and future). This module takes raw Cube
 * /meta cube info and synthesizes a minimal `Preset`.
 *
 * The synth is intentionally conservative:
 *   - identity dim: heuristic on dimension name (`*.user_id`, `*.uid`, etc.)
 *   - headline KPIs: count-like measure, revenue/value-like measure, paying-
 *     like measure, then first numeric measure as filler — up to 4
 *   - tabs: one Overview with composition cards over the first 3 categorical
 *     dimensions plus a 90-day line if a time dimension exists
 *   - member columns: identity only (no surprise fields)
 *
 * Curated presets always win — this is the fallback path.
 */

import type {
  CardSpec,
  KpiSpec,
  Preset,
  TabDef,
} from './types';

export interface CubeMetaField {
  name: string;
  type?: string;
  title?: string;
}

export interface CubeMetaCube {
  name: string;
  measures?: CubeMetaField[];
  dimensions?: CubeMetaField[];
}

const ID_DIM_PATTERNS = [/\.user_id$/i, /\.uid$/i, /\.userid$/i, /\.account_id$/i];
const ID_LIKE_DIM_NAMES = /(_id|_uid|_key|_pk)$/i;

const COUNT_MEASURE_PATTERNS = [/\.count$/i, /\.user_count$/i, /\.users$/i, /_count$/i];
const REVENUE_MEASURE_PATTERNS = [/revenue/i, /ltv/i, /_value/i, /\.value_/i];
const PAYING_MEASURE_PATTERNS = [/paying/i, /active/i, /dau/i, /mau/i];

function findIdentityDim(cube: CubeMetaCube): string | null {
  const dims = cube.dimensions ?? [];
  for (const pattern of ID_DIM_PATTERNS) {
    const hit = dims.find((d) => pattern.test(d.name));
    if (hit) return hit.name;
  }
  // Fallback: first string dim whose name ends in _id-like suffix.
  const stringIdLike = dims.find(
    (d) => d.type === 'string' && ID_LIKE_DIM_NAMES.test(d.name),
  );
  return stringIdLike?.name ?? null;
}

function firstMatching(
  measures: CubeMetaField[],
  patterns: RegExp[],
): CubeMetaField | undefined {
  for (const p of patterns) {
    const hit = measures.find((m) => p.test(m.name));
    if (hit) return hit;
  }
  return undefined;
}

function shortLabel(field: CubeMetaField): string {
  // Strip cube prefix and split on underscore.
  const local = field.name.split('.').pop() ?? field.name;
  return local
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function pickHeadlineKpis(cube: CubeMetaCube): KpiSpec[] {
  const measures = (cube.measures ?? []).filter((m) => m.type === 'number');
  const out: KpiSpec[] = [];
  const used = new Set<string>();

  const push = (m: CubeMetaField | undefined, fallbackLabel: string, format: KpiSpec['format']) => {
    if (!m || used.has(m.name) || out.length >= 4) return;
    used.add(m.name);
    out.push({
      id: m.name.split('.').pop() ?? m.name,
      label: m.title ? shortLabel(m) : fallbackLabel,
      measure: m.name,
      format,
    });
  };

  push(firstMatching(measures, COUNT_MEASURE_PATTERNS),  'Size',    'compact');
  push(firstMatching(measures, REVENUE_MEASURE_PATTERNS),'Revenue', 'currency');
  push(firstMatching(measures, PAYING_MEASURE_PATTERNS), 'Active',  'compact');

  // Fill remaining slots with the first non-used numeric measures.
  for (const m of measures) {
    if (out.length >= 4) break;
    if (used.has(m.name)) continue;
    push(m, shortLabel(m), 'compact');
  }
  return out;
}

function pickCategoricalDims(cube: CubeMetaCube, limit: number): CubeMetaField[] {
  const dims = (cube.dimensions ?? []).filter(
    (d) => d.type === 'string' && !ID_LIKE_DIM_NAMES.test(d.name),
  );
  return dims.slice(0, limit);
}

function pickTimeDim(cube: CubeMetaCube): CubeMetaField | null {
  return (cube.dimensions ?? []).find((d) => d.type === 'time') ?? null;
}

function buildOverviewTab(cube: CubeMetaCube, sizeMeasure: string | null): TabDef {
  const cards: CardSpec[] = [];
  const dims = pickCategoricalDims(cube, 3);
  const groupingMeasure = sizeMeasure ?? cube.measures?.[0]?.name;

  if (groupingMeasure) {
    for (const d of dims) {
      cards.push({
        kind: 'composition',
        id: `auto-comp-${d.name.split('.').pop()}`,
        label: shortLabel(d),
        measure: groupingMeasure,
        groupBy: d.name,
        limit: 6,
      });
    }
  }

  const timeDim = pickTimeDim(cube);
  if (groupingMeasure && timeDim) {
    cards.push({
      kind: 'line',
      id: 'auto-trend-90d',
      label: `${shortLabel({ name: groupingMeasure })} (last 90 days)`,
      measure: groupingMeasure,
      timeDimension: timeDim.name,
      dateRange: 'last 90 days',
      granularity: 'day',
      format: 'compact',
    });
  }

  return {
    id: 'overview',
    label: 'Overview',
    gridCols: 2,
    kpis: [],
    cards,
  };
}

/**
 * Synthesize a minimal Preset for `cubeName` from raw cube meta.
 * Returns null only when the cube has no identity dim AND no numeric measures
 * — too little to render anything useful.
 */
export function synthesizeAutoPreset(
  meta: { cubes: CubeMetaCube[] },
  cubeName: string,
): Preset | null {
  const cube = meta.cubes.find((c) => c.name === cubeName);
  if (!cube) return null;

  const identityDim = findIdentityDim(cube);
  const headlineKpis = pickHeadlineKpis(cube);
  if (!identityDim && headlineKpis.length === 0) return null;

  const sizeMeasure = headlineKpis[0]?.measure ?? null;

  return {
    id: `auto-${cubeName}`,
    label: `Auto · ${cubeName}`,
    hubCube: cubeName,
    // Empty identityDim is invalid for Members tab queries but the rest
    // of the detail view still works — we render '' so members shows
    // identity column with raw uids and no extras.
    identityDim: identityDim ?? '',
    reachableCubes: [cubeName],
    headlineKpis,
    tabs: [buildOverviewTab(cube, sizeMeasure)],
    // No member columns — too risky to guess.
    auto: true,
  };
}
