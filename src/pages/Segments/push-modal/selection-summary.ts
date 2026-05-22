/**
 * Pure aggregation helper for the push-modal selection summary.
 * Computes top-3 values for up to 3 categorical columns and a single avg
 * over the first numeric column it finds.
 */

export interface CategoricalSummary {
  column: string;
  topValues: Array<{ value: string; count: number }>;
}

export interface NumericSummary {
  column: string;
  avg: number;
  min: number;
  max: number;
}

export interface SelectionSummaryResult {
  total: number;
  categoricals: CategoricalSummary[];
  numeric: NumericSummary | null;
}

export function summarizeSelection(
  rows: Record<string, unknown>[],
  options: {
    maxCategoricals?: number;
    maxTopValues?: number;
    /**
     * Column keys to omit from the summary entirely. The push-modal uses this
     * to drop the bare time-dim key (e.g. `active_daily.log_date`) when its
     * granularity-suffixed counterpart (e.g. `active_daily.log_date.week`) is
     * already in the row — Cube returns both and they hold the same value.
     */
    excludeColumns?: string[];
  } = {},
): SelectionSummaryResult {
  const maxCategoricals = options.maxCategoricals ?? 3;
  const maxTopValues = options.maxTopValues ?? 3;
  const exclude = new Set(options.excludeColumns ?? []);

  if (rows.length === 0) {
    return { total: 0, categoricals: [], numeric: null };
  }

  const sample = rows[0];
  const stringCols: string[] = [];
  const numericCols: string[] = [];

  for (const [key, value] of Object.entries(sample)) {
    if (exclude.has(key)) continue;
    if (typeof value === 'number') numericCols.push(key);
    else if (typeof value === 'string') stringCols.push(key);
  }

  const categoricals: CategoricalSummary[] = stringCols
    .slice(0, maxCategoricals)
    .map((column) => {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const v = row[column];
        if (v == null) continue;
        const key = String(v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const topValues = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxTopValues)
        .map(([value, count]) => ({ value, count }));
      return { column, topValues };
    });

  let numeric: NumericSummary | null = null;
  for (const col of numericCols) {
    const values = rows
      .map((r) => r[col])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length === 0) continue;
    const sum = values.reduce((a, b) => a + b, 0);
    numeric = {
      column: col,
      avg: sum / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    };
    break;
  }

  return { total: rows.length, categoricals, numeric };
}
