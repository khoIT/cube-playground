/**
 * exportCohortCsv — pure function that serialises CohortRow[] to a CSV string.
 *
 * Two modes:
 *   'counts'  — d1, d3, d7, d14, d30 as raw retained user counts.
 *   'percent' — d1, d3, d7, d14, d30 as retention percentages (one decimal).
 *
 * Triggers a browser download via a temporary anchor element.
 */

import type { CohortRow } from './pivot-cohort-rows';

export type CsvMode = 'counts' | 'percent';

const HEADER_COUNTS  = 'installDate,cohortSize,d1,d3,d7,d14,d30';
const HEADER_PERCENT = 'installDate,cohortSize,d1Pct,d3Pct,d7Pct,d14Pct,d30Pct';

/** Escapes a CSV cell value (wraps in quotes when it contains comma/quote/newline). */
function escapeCell(value: string | number): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * Converts CohortRow[] into a CSV string.
 * Returns an empty string when rows is empty.
 */
export function cohortRowsToCsv(rows: CohortRow[], mode: CsvMode): string {
  if (rows.length === 0) return '';

  const header = mode === 'counts' ? HEADER_COUNTS : HEADER_PERCENT;

  const lines = rows.map((r) => {
    const cells =
      mode === 'counts'
        ? [r.installDate, r.size, r.d1, r.d3, r.d7, r.d14, r.d30]
        : [r.installDate, r.size, r.d1Pct, r.d3Pct, r.d7Pct, r.d14Pct, r.d30Pct];
    return cells.map(escapeCell).join(',');
  });

  return [header, ...lines].join('\n');
}

/**
 * Triggers a browser file download of the cohort grid as CSV.
 *
 * @param rows    CohortRow[] to export.
 * @param mode    'counts' | 'percent'.
 * @param gameId  Used to build a descriptive filename.
 */
export function downloadCohortCsv(
  rows: CohortRow[],
  mode: CsvMode,
  gameId: string,
): void {
  const csv = cohortRowsToCsv(rows, mode);
  if (!csv) return;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);

  const suffix   = mode === 'counts' ? 'counts' : 'percent';
  const dateStr  = new Date().toISOString().slice(0, 10);
  const filename = `cohort-retention-${gameId}-${dateStr}-${suffix}.csv`;

  const a = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Release the object URL after the click event has been processed.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
