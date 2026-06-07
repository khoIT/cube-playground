/**
 * Single-query funnel dispatcher against the ordered_event_funnel cube.
 *
 * Input: ordered list of event names, conversion window in ms, and the
 * detected ordered-funnel cube name.
 *
 * Query shape (matches docs/ordered-funnel-cube-template.md):
 *   measures:   [cubeName.step_count]
 *   dimensions: [cubeName.step_index]
 *   filters:    [{ member: cubeName.step_name, operator: 'equals', values: orderedEvents }]
 *   order:      { cubeName.step_index: 'asc' }
 *   dateRange (optional): from windowMs translated to "last N days/hours"
 *
 * Output: { steps, badge } where steps carry computed drop-off metrics.
 * Multi-query fallback is intentionally absent — see phase-06 deviation note.
 */

export interface FunnelStep {
  /** Display label — the event name at this step position */
  name: string;
  /** Distinct user count reaching this step */
  count: number;
  /** Absolute drop from previous step (0 for first step) */
  dropFromPrev: number;
  /** Drop-off percentage relative to previous step (0 for first step) */
  dropPct: number;
}

export interface FunnelResult {
  steps: FunnelStep[];
  /** 'canonical' = served by the pre-aggregated fixed-step cube (CubeStore). */
  badge: 'ordered' | 'canonical';
}

/**
 * Step orders the canonical pre-aggregated cube materialises (per-game event
 * sets — see cube-dev ordered_funnel_canonical.yml). The canonical cube is
 * only correct for an EXACT match: its step indices are chronological over
 * its fixed event set, so any subset/superset selection must fall back to the
 * parametric live cube.
 */
const CANONICAL_STEP_ORDERS: string[][] = [
  ['register', 'login', 'recharge'],
  ['login', 'currency_flow'],
];

function matchesCanonicalOrder(orderedEvents: string[]): boolean {
  return CANONICAL_STEP_ORDERS.some(
    (order) =>
      order.length === orderedEvents.length &&
      order.every((e, i) => e === orderedEvents[i]),
  );
}

export interface RunFunnelInput {
  orderedEvents: string[];
  /** Conversion window in milliseconds */
  windowMs: number;
  /** The cube name returned by useFunnelDetection */
  cubeName: string;
  /**
   * Pre-aggregated canonical cube (from useFunnelDetection), used instead of
   * cubeName when orderedEvents exactly matches a canonical step order.
   */
  canonicalCubeName?: string | null;
  cubejsApi: CubejsLikeApi;
}

export interface CubejsLikeApi {
  // Accept unknown so callers using the real cubejs API type (which uses a
  // broader union) can pass it without an unsafe cast.
  load(query: unknown): Promise<CubeResultSet>;
}

interface CubeQuery {
  measures: string[];
  dimensions: string[];
  filters: CubeFilter[];
  order: Record<string, 'asc' | 'desc'>;
  timeDimensions?: CubeTimeDimension[];
}

interface CubeFilter {
  member: string;
  operator: string;
  values: string[];
}

interface CubeTimeDimension {
  dimension: string;
  dateRange: [string, string];
}

interface CubeResultSet {
  tablePivot(): Array<Record<string, string | number | null>>;
}

/** Translate a window in ms to an ISO date range [from, to] relative to now. */
function windowToDateRange(windowMs: number): [string, string] {
  const to = new Date();
  const from = new Date(to.getTime() - windowMs);
  return [from.toISOString(), to.toISOString()];
}

/**
 * Compute drop-off metrics from an array of raw step counts.
 * Counts are expected in step_index ascending order.
 */
function computeDropOff(
  labels: string[],
  counts: number[],
): FunnelStep[] {
  return counts.map((count, idx) => {
    const prev = idx === 0 ? count : counts[idx - 1];
    const dropFromPrev = idx === 0 ? 0 : Math.max(0, prev - count);
    const dropPct = idx === 0 || prev === 0 ? 0 : (dropFromPrev / prev) * 100;
    return {
      name: labels[idx] ?? `Step ${idx + 1}`,
      count,
      dropFromPrev,
      dropPct,
    };
  });
}

export async function runFunnel(input: RunFunnelInput): Promise<FunnelResult> {
  const { orderedEvents, windowMs, cubeName, canonicalCubeName, cubejsApi } = input;

  if (orderedEvents.length < 2) {
    throw new Error('Funnel requires at least 2 events');
  }
  if (orderedEvents.length > 6) {
    throw new Error('Funnel supports at most 6 events');
  }

  // Exact canonical step order + canonical cube deployed → serve from the
  // pre-aggregation (milliseconds via CubeStore) instead of the live window
  // scan. Any other step selection keeps the parametric cube.
  const useCanonical = !!canonicalCubeName && matchesCanonicalOrder(orderedEvents);
  const activeCube = useCanonical ? (canonicalCubeName as string) : cubeName;

  const stepCountMember = `${activeCube}.step_count`;
  const stepIndexDim = `${activeCube}.step_index`;
  const stepNameDim = `${activeCube}.step_name`;

  const [dateFrom, dateTo] = windowToDateRange(windowMs);

  const query: CubeQuery = {
    measures: [stepCountMember],
    dimensions: [stepIndexDim],
    filters: [
      {
        member: stepNameDim,
        operator: 'equals',
        values: orderedEvents,
      },
    ],
    order: { [stepIndexDim]: 'asc' },
    timeDimensions: [
      {
        // The cube template uses the event timestamp exposed via the time dimension.
        // Dimension name follows convention: <cube>.ts
        dimension: `${activeCube}.ts`,
        dateRange: [dateFrom, dateTo],
      },
    ],
  };

  let resultSet: CubeResultSet;
  try {
    resultSet = await cubejsApi.load(query);
  } catch (err) {
    throw new Error(`Funnel query failed: ${(err as Error).message}`);
  }

  const rows = resultSet.tablePivot();

  // Build a map from step_index → count. step_index is 1-based per the template.
  const indexToCount = new Map<number, number>();
  for (const row of rows) {
    const idx = Number(row[stepIndexDim]);
    const cnt = Number(row[stepCountMember] ?? 0);
    if (!Number.isNaN(idx)) {
      indexToCount.set(idx, cnt);
    }
  }

  // Align counts to orderedEvents using their position (1-based step_index).
  // If the backend omitted a step (zero users), default to 0.
  const counts = orderedEvents.map((_, i) => indexToCount.get(i + 1) ?? 0);

  return {
    steps: computeDropOff(orderedEvents, counts),
    badge: useCanonical ? 'canonical' : 'ordered',
  };
}
