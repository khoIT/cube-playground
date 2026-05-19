/**
 * Pure CSV uid-list parser for the /api/segments/import-ids flow.
 *
 * Accepts either a single header column named user_id|uid|id, or headerless CSV.
 * Strips BOM, normalises CRLF→LF, dedupes (preserves first-occurrence order),
 * rejects non-printable / >256-char rows, and hard-caps at MAX_ROWS.
 */

export interface CsvImportError {
  line: number;
  reason: string;
}

export interface CsvImportResult {
  uids: string[];
  errors: CsvImportError[];
  truncated: boolean;
}

export const MAX_ROWS = 5_000;
const MAX_VALUE_LEN = 256;
const PRINTABLE_RE = /^[\x20-\x7E]+$/;
const HEADER_ALIASES = new Set(['user_id', 'uid', 'id', 'customer_id', 'player_id']);

function stripBom(s: string): string {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

export function parseUidCsv(rawInput: string | Buffer): CsvImportResult {
  const raw = stripBom(
    typeof rawInput === 'string' ? rawInput : rawInput.toString('utf8'),
  );

  // Reject obvious binary upfront: any null byte means we won't trust it.
  if (raw.includes('\x00')) {
    return { uids: [], errors: [{ line: 0, reason: 'binary content detected' }], truncated: false };
  }

  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const errors: CsvImportError[] = [];
  const seen = new Set<string>();
  const uids: string[] = [];
  let truncated = false;

  let startIdx = 0;
  if (lines.length > 0) {
    const first = lines[0].trim().toLowerCase();
    if (HEADER_ALIASES.has(first)) {
      startIdx = 1;
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line == null) continue;
    const value = line.trim();
    if (value.length === 0) continue;

    if (value.length > MAX_VALUE_LEN) {
      errors.push({ line: i + 1, reason: `value exceeds ${MAX_VALUE_LEN} chars` });
      continue;
    }
    if (!PRINTABLE_RE.test(value)) {
      errors.push({ line: i + 1, reason: 'value contains non-printable / non-ASCII chars' });
      continue;
    }

    if (seen.has(value)) continue;
    if (uids.length >= MAX_ROWS) {
      truncated = true;
      break;
    }

    seen.add(value);
    uids.push(value);
  }

  return { uids, errors, truncated };
}
