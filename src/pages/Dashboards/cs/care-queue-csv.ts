/**
 * CSV serialisation for the VIP care queue export.
 *
 * Safe-escapes field values that contain commas, double-quotes, or newlines
 * per RFC 4180 so the downloaded file opens correctly in Excel / Google Sheets.
 *
 * Intentionally pure (no React, no fetch) — easy to unit-test and reuse.
 */

// ── Row shape ─────────────────────────────────────────────────────────────────

export interface CsvRow {
  uid: string;
  name: string | null;
  ltvVnd: number | null;
  tier: string | null;
  topPlaybook: string | null;
  openCaseCount: number;
  lastContact: string | null;
  status: string;
}

// Column order is load-bearing — tests assert position by index.
const HEADERS: (keyof CsvRow)[] = [
  'uid',
  'name',
  'ltvVnd',
  'tier',
  'topPlaybook',
  'openCaseCount',
  'lastContact',
  'status',
];

// ── RFC 4180 field escaping ───────────────────────────────────────────────────

/**
 * Wraps the value in double-quotes and doubles any embedded double-quote
 * characters. Required whenever the value contains a comma, double-quote,
 * or newline — all of which would break a naive CSV reader.
 */
function escapeField(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  // Only wrap/escape when necessary to keep plain values readable.
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Converts an array of VIP rows to a RFC 4180 CSV string.
 * Always includes the header row even when `rows` is empty.
 */
export function toCsv(rows: CsvRow[]): string {
  const lines: string[] = [HEADERS.join(',')];
  for (const row of rows) {
    lines.push(HEADERS.map((col) => escapeField(row[col])).join(','));
  }
  return lines.join('\n');
}

/**
 * Triggers a browser file download for the given CSV text.
 * Uses a Blob + temporary anchor element — no server round-trip.
 */
export function downloadCsv(filename: string, csvText: string): void {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Clean up — short delay lets the browser pick up the download before revoke.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 150);
}

/**
 * Returns a filename like `care-queue-cfm_vn-20260609-1430.csv` stamped in
 * GMT+7 (Asia/Ho_Chi_Minh) so the file name reflects local business time.
 */
export function buildCsvFilename(game: string): string {
  const now = new Date();
  // Format in GMT+7 without a library dependency.
  const gmt7 = new Date(now.getTime() + 7 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date =
    `${gmt7.getUTCFullYear()}${pad(gmt7.getUTCMonth() + 1)}${pad(gmt7.getUTCDate())}` +
    `-${pad(gmt7.getUTCHours())}${pad(gmt7.getUTCMinutes())}`;
  return `care-queue-${game}-${date}.csv`;
}
