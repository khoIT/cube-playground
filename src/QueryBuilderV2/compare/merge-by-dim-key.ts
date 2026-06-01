/**
 * Pure function: left-join current rows × comparison rows on a composite
 * dimension key, then compute Δ and Δ% for each measure.
 *
 * - Current rows are the authoritative set (left-join semantics).
 * - Missing comparison rows → Δ columns render as null ("—" in UI).
 * - Zero denominator in Δ% → null (not Infinity).
 * - NaN values on either side → treated as null.
 *
 * No React imports — fully testable as a pure module.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataRow = Record<string, string | number | null | undefined>;

export interface MergedRow extends DataRow {
  /** Suffixed keys: <measure>__cmp = comparison value */
  [key: `${string}__cmp`]: number | null;
  /** Suffixed keys: <measure>__delta = Δ */
  [key: `${string}__delta`]: number | null;
  /** Suffixed keys: <measure>__deltaPct = Δ% (0.05 = 5%) */
  [key: `${string}__deltaPct`]: number | null;
}

export interface MergeOptions {
  /** Cube member names used as the join key (dimensions + time dim keys). */
  dimKeys: string[];
  /** Cube measure names for which to compute deltas. */
  measures: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNum(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v as string);
  return isFinite(n) ? n : null;
}

// Cross-game comparisons hit dimension-vocabulary drift — e.g. one game emits
// os_platform 'IOS' where another emits 'ios'. Normalize each key part
// (trim + lowercase) so rows align across that casing/whitespace drift. Same-
// game comparisons already match exactly, so normalization is a no-op there.
function normKeyPart(v: string | number | null | undefined): string {
  return String(v ?? '').trim().toLowerCase();
}

function buildIndex(rows: DataRow[], dimKeys: string[]): Map<string, DataRow> {
  const map = new Map<string, DataRow>();
  for (const row of rows) {
    const key = dimKeys.map((k) => normKeyPart(row[k])).join('\x00');
    // First occurrence wins — Cube should not return duplicate dim keys but
    // we guard defensively.
    if (!map.has(key)) {
      map.set(key, row);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Left-join `current` rows with `comparison` rows on `dimKeys`.
 * Returns augmented rows with `__cmp`, `__delta`, `__deltaPct` suffixed
 * columns for every measure listed in `measures`.
 */
export function mergeByDimKey(
  current: DataRow[],
  comparison: DataRow[],
  opts: MergeOptions,
): MergedRow[] {
  const { dimKeys, measures } = opts;
  const compIndex = buildIndex(comparison, dimKeys);

  return current.map((row) => {
    const key = dimKeys.map((k) => normKeyPart(row[k])).join('\x00');
    const compRow = compIndex.get(key) ?? null;

    const extra: Record<string, number | null> = {};

    for (const measure of measures) {
      const curr = toNum(row[measure]);
      const comp = compRow != null ? toNum(compRow[measure]) : null;

      extra[`${measure}__cmp`] = comp;
      extra[`${measure}__delta`] = curr != null && comp != null ? curr - comp : null;
      extra[`${measure}__deltaPct`] =
        curr != null && comp != null && comp !== 0
          ? (curr - comp) / comp
          : null;
    }

    return { ...row, ...extra } as MergedRow;
  });
}

// ---------------------------------------------------------------------------
// Overlap stats
// ---------------------------------------------------------------------------

export interface OverlapStats {
  /** Rows the comparison query returned. */
  comparisonRowCount: number;
  /** Current rows whose dim-key was found in the comparison set. */
  matchedRowCount: number;
}

/**
 * How well the two sides line up on `dimKeys`. Drives the "no comparable rows"
 * heads-up: a cross-game compare on a per-entity dimension (e.g. `user_id`)
 * returns plenty of comparison rows but zero matches, because the two games'
 * entity populations are disjoint. Uses the SAME normalized key as the merge so
 * the count can't disagree with what mergeByDimKey actually paired.
 */
export function computeOverlap(
  current: DataRow[],
  comparison: DataRow[],
  dimKeys: string[],
): OverlapStats {
  const compIndex = buildIndex(comparison, dimKeys);
  let matched = 0;
  for (const row of current) {
    const key = dimKeys.map((k) => normKeyPart(row[k])).join('\x00');
    if (compIndex.has(key)) matched += 1;
  }
  return { comparisonRowCount: comparison.length, matchedRowCount: matched };
}
