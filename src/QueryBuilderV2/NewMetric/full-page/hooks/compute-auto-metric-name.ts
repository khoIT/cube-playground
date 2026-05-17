import type { NewMetricDraftV2, NewMetricDraftV3, DimBuilder, ArtifactKind } from '../../types';
import type { FilterGroup, FilterLeaf, FilterNode } from '../../filter-tree';
import { primarySlotIdFor } from '../steps/step-2-operation/operations';

const OPERATION_TITLES: Record<string, string> = {
  sum: 'Sum',
  count: 'Count',
  countDistinct: 'Distinct count',
  avg: 'Average',
  min: 'Min',
  max: 'Max',
  median: 'Median',
  percentile: 'P95',
  ratio: 'Ratio',
  weightedAvg: 'Weighted average',
  formula: 'Formula',
};

const TIME_UNIT_PREFIX: Record<'day' | 'hour' | 'month', string> = {
  day: 'days_since',
  hour: 'hours_since',
  month: 'months_since',
};

const SEGMENT_SLUG_MAX = 24;
const BOOLEAN_SLUG_MAX = 32;

// Common stopwords stripped from segment slugs so leaves like `country='VN'`
// produce `vn` instead of `country_vn`. Kept short — the rest of the slug
// comes from leaf values which are usually meaningful tokens already.
const STOPWORDS = new Set(['the', 'and', 'or', 'is', 'of', 'a', 'an', 'to', 'in']);

function leafOf(member: string | null | undefined): string {
  if (!member) return '';
  return member.includes('.') ? member.split('.').slice(-1)[0] : member;
}

function snakeOp(op: string | null | undefined): string {
  return (op ?? 'metric').replace(/([A-Z])/g, '_$1').toLowerCase();
}

function asV3(draft: NewMetricDraftV2 | NewMetricDraftV3): NewMetricDraftV3 {
  // Defensive default for legacy V2 callers — auto-name dispatcher uses the
  // discriminator to pick the right rule. Missing discriminator = measure.
  if ((draft as NewMetricDraftV3).artifactKind) return draft as NewMetricDraftV3;
  return { ...(draft as NewMetricDraftV2), artifactKind: 'measure' as ArtifactKind };
}

// ---------------------------------------------------------------------------
// Measure — existing rules, unchanged.
// ---------------------------------------------------------------------------

function computeMeasureName(draft: NewMetricDraftV3): string {
  const primaryCube = draft.sourceCubes[0] ?? null;
  if (!primaryCube) return 'untitled_metric';

  const op = snakeOp(draft.operation);

  if (draft.operation === 'ratio') {
    const numerator = leafOf(draft.inputs.numerator);
    const denominator = leafOf(draft.inputs.denominator);
    if (numerator && denominator) return `ratio_${numerator}_per_${denominator}`;
    if (numerator) return `ratio_${numerator}`;
    return `ratio_${primaryCube}`;
  }

  const primarySlot = primarySlotIdFor(draft.operation);
  const leaf = leafOf(draft.inputs[primarySlot]);
  if (leaf) return `${op}_${leaf}`;
  if (draft.operation === 'count') return `count_${primaryCube}`;
  return `${op}_${primaryCube}`;
}

function computeMeasureTitle(draft: NewMetricDraftV3): string {
  const primaryCube = draft.sourceCubes[0] ?? null;
  if (!primaryCube || !draft.operation) return '';

  const opTitle = OPERATION_TITLES[draft.operation] ?? draft.operation;
  const humanize = (m: string | null | undefined) => leafOf(m).replace(/_/g, ' ').trim();

  if (draft.operation === 'ratio') {
    const a = humanize(draft.inputs.numerator);
    const b = humanize(draft.inputs.denominator);
    if (a && b) return `Ratio of ${a} per ${b}`;
    if (a) return `Ratio of ${a}`;
    return 'Ratio';
  }

  const primarySlot = primarySlotIdFor(draft.operation);
  const colHuman = humanize(draft.inputs[primarySlot]);
  if (colHuman) return `${opTitle} of ${colHuman}`;
  if (draft.operation === 'count') return `Count of ${primaryCube}`;
  return opTitle;
}

// ---------------------------------------------------------------------------
// Dimension — per sub-kind rules. Banding strips numeric/measure suffixes so
// `ingame_total_recharge_value_vnd` → `recharge_value_vnd_tier`; falls back to
// the raw column when no recognisable suffix is present.
// ---------------------------------------------------------------------------

function trimNumericPrefix(col: string): string {
  // Drop verbose prefixes the metric catalogue uses for raw numeric columns so
  // the banding name reads as a tier, not a measure copy.
  return col
    .replace(/^ingame_total_/, '')
    .replace(/^total_/, '')
    .replace(/^raw_/, '');
}

function predicateSlug(leaf: FilterLeaf): string {
  const opMap: Record<string, string> = {
    '=': 'eq',
    '!=': 'neq',
    '>': 'gt',
    '<': 'lt',
    '>=': 'gte',
    '<=': 'lte',
    IN: 'in',
    'NOT IN': 'nin',
    contains: 'has',
    startsWith: 'pre',
    set: 'set',
    notSet: 'unset',
  };
  const col = leaf.column.replace(/\W+/g, '_').toLowerCase();
  const op = opMap[leaf.op] ?? 'cond';
  const val = (leaf.values[0] ?? '').toString().replace(/\W+/g, '_').toLowerCase();
  return val ? `${col}_${op}_${val}` : `${col}_${op}`;
}

function computeDimensionName(draft: NewMetricDraftV3): string {
  const builder = draft.dimBuilder;
  const primaryCube = draft.sourceCubes[0] ?? null;
  if (!builder) return primaryCube ? 'untitled_dimension' : 'untitled_dimension';

  switch (builder.kind) {
    case 'banding': {
      if (!builder.column) return 'untitled_dimension';
      const trimmed = trimNumericPrefix(builder.column);
      return `${trimmed}_tier`;
    }
    case 'time-since': {
      if (!builder.timeColumn) return 'untitled_dimension';
      const prefix = TIME_UNIT_PREFIX[builder.unit] ?? 'days_since';
      return `${prefix}_${builder.timeColumn}`;
    }
    case 'passthrough': {
      if (!builder.column) return 'untitled_dimension';
      return builder.column;
    }
    case 'boolean': {
      if (!builder.predicate) return 'untitled_dimension';
      const slug = predicateSlug(builder.predicate);
      const candidate = `is_${slug}`;
      return candidate.slice(0, BOOLEAN_SLUG_MAX).replace(/_+$/, '');
    }
  }
}

function computeDimensionTitle(draft: NewMetricDraftV3): string {
  const name = computeDimensionName(draft);
  if (name.startsWith('untitled_')) return '';
  return name.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Segment — slug stitches first non-stopword leaf value + a second hint when
// available, capped at SEGMENT_SLUG_MAX chars to match `vn_whales`-style names.
// ---------------------------------------------------------------------------

function collectLeaves(node: FilterNode, acc: FilterLeaf[]): void {
  if (node.kind === 'leaf') {
    acc.push(node);
    return;
  }
  for (const child of node.children) collectLeaves(child, acc);
}

function tokensFromLeaf(leaf: FilterLeaf): string[] {
  const tokens: string[] = [];
  for (const v of leaf.values) {
    const s = v.toString().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (s && !STOPWORDS.has(s)) tokens.push(s);
  }
  // Numeric thresholds — emit an order-of-magnitude hint (e.g. 10000000 → 10m).
  if (tokens.length === 0 && (leaf.columnType === 'number' || leaf.columnType === 'integer')) {
    const n = Number(leaf.values[0]);
    if (Number.isFinite(n) && n >= 1000) {
      const order = n >= 1e9 ? 'b' : n >= 1e6 ? 'm' : n >= 1e3 ? 'k' : '';
      const mantissa = Math.round(n / (n >= 1e9 ? 1e9 : n >= 1e6 ? 1e6 : 1e3));
      tokens.push(`${mantissa}${order}`);
    }
  }
  if (tokens.length === 0) {
    const colSlug = leaf.column.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    if (colSlug) tokens.push(colSlug);
  }
  return tokens;
}

function computeSegmentName(draft: NewMetricDraftV3): string {
  const tree: FilterGroup = draft.filterTree;
  const leaves: FilterLeaf[] = [];
  collectLeaves(tree, leaves);
  if (leaves.length === 0) return 'untitled_segment';

  const tokens: string[] = [];
  for (const leaf of leaves) {
    for (const t of tokensFromLeaf(leaf)) {
      if (!tokens.includes(t)) tokens.push(t);
      if (tokens.join('_').length >= SEGMENT_SLUG_MAX) break;
    }
    if (tokens.join('_').length >= SEGMENT_SLUG_MAX) break;
  }
  const joined = tokens.join('_').slice(0, SEGMENT_SLUG_MAX).replace(/_+$/, '');
  return joined || 'untitled_segment';
}

function computeSegmentTitle(draft: NewMetricDraftV3): string {
  const name = computeSegmentName(draft);
  if (name === 'untitled_segment') return '';
  return `Segment: ${name.replace(/_/g, ' ')}`;
}

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------

function applyCollisionSuffix(name: string, existing?: Set<string>): string {
  if (!existing || existing.size === 0) return name;
  if (!existing.has(name)) return name;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${name}_${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return name;
}

/**
 * Derives a default identifier from the draft. Discriminates on
 * `draft.artifactKind`:
 *
 *  - measure   → existing op+column logic (regression-stable)
 *  - dimension → per dim-kind builder (banding/time-since/passthrough/boolean)
 *  - segment   → slug built from filter-tree leaves
 *
 * When `existing` is provided, the name is suffixed (`_2`, `_3`, …) until it
 * does not collide with any name in the set. `existing` is expected to come
 * from the target cube's `/meta` and to include names of every kind so the
 * splicer's within-kind uniqueness check passes on first submit.
 */
export function computeAutoMetricName(
  draft: NewMetricDraftV2 | NewMetricDraftV3,
  existing?: Set<string>
): string {
  const v3 = asV3(draft);
  let name: string;
  switch (v3.artifactKind) {
    case 'dimension':
      name = computeDimensionName(v3);
      break;
    case 'segment':
      name = computeSegmentName(v3);
      break;
    case 'measure':
    default:
      name = computeMeasureName(v3);
  }
  return applyCollisionSuffix(name, existing);
}

/** Human-readable title companion. Discriminates on artifactKind. */
export function computeAutoMetricTitle(draft: NewMetricDraftV2 | NewMetricDraftV3): string {
  const v3 = asV3(draft);
  switch (v3.artifactKind) {
    case 'dimension':
      return computeDimensionTitle(v3);
    case 'segment':
      return computeSegmentTitle(v3);
    case 'measure':
    default:
      return computeMeasureTitle(v3);
  }
}
