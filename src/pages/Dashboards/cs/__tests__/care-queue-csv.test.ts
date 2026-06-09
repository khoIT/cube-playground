/**
 * care-queue-csv — CSV serialisation of the VIP care queue.
 *
 * Verifies: header row presence, column order, safe-escaping of values that
 * contain commas, double-quotes, or newlines (all three are RFC 4180 hazards),
 * and the empty-input degenerate case.
 */

import { describe, it, expect } from 'vitest';
import { toCsv } from '../care-queue-csv';
import type { CsvRow } from '../care-queue-csv';

// ── Helpers ───────────────────────────────────────────────────────────────────

function rows(lines: string[]): string[][] {
  // Naive splitter for tests — splits on commas OUTSIDE double-quote pairs.
  return lines.map((line) => {
    const result: string[] = [];
    let inQuote = false;
    let cell = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === ',' && !inQuote) {
        result.push(cell);
        cell = '';
      } else {
        cell += ch;
      }
    }
    result.push(cell);
    return result;
  });
}

function makeRow(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    uid: 'u001',
    name: 'Player One',
    ltvVnd: 5_000_000,
    tier: 'Gold',
    topPlaybook: 'VIP Re-engage',
    openCaseCount: 2,
    lastContact: '2026-06-01T10:00:00Z',
    status: 'new',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('toCsv', () => {
  it('outputs a header row when the input array is empty', () => {
    const csv = toCsv([]);
    const lines = csv.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('uid');
    expect(lines[0]).toContain('name');
    expect(lines[0]).toContain('ltvVnd');
    expect(lines[0]).toContain('tier');
    expect(lines[0]).toContain('topPlaybook');
    expect(lines[0]).toContain('openCaseCount');
    expect(lines[0]).toContain('lastContact');
    expect(lines[0]).toContain('status');
  });

  it('preserves exact column order: uid,name,ltvVnd,tier,topPlaybook,openCaseCount,lastContact,status', () => {
    const csv = toCsv([makeRow()]);
    const [header] = rows(csv.split('\n').filter(Boolean));
    expect(header).toEqual(['uid', 'name', 'ltvVnd', 'tier', 'topPlaybook', 'openCaseCount', 'lastContact', 'status']);
  });

  it('serialises a plain row correctly', () => {
    const r = makeRow({ uid: 'u42', ltvVnd: 1_000_000, openCaseCount: 3, status: 'in_review' });
    const csv = toCsv([r]);
    const parsed = rows(csv.split('\n').filter(Boolean));
    expect(parsed).toHaveLength(2); // header + 1 data row
    const data = parsed[1];
    expect(data[0]).toBe('u42');
    expect(data[2]).toBe('1000000');
    expect(data[5]).toBe('3');
    expect(data[7]).toBe('in_review');
  });

  it('escapes a name that contains a comma', () => {
    // RFC 4180: field containing comma must be wrapped in double quotes.
    const csv = toCsv([makeRow({ name: 'Smith, John' })]);
    const [, data] = rows(csv.split('\n').filter(Boolean));
    expect(data[1]).toBe('Smith, John'); // parser strips the wrapping quotes
    // Raw CSV must have the quotes present.
    expect(csv).toContain('"Smith, John"');
  });

  it('escapes a name that contains a double-quote character', () => {
    // RFC 4180: embedded double-quote → doubled ("").
    const csv = toCsv([makeRow({ name: 'Nguyễn "The Boss" Hùng' })]);
    expect(csv).toContain('"Nguyễn ""The Boss"" Hùng"');
    const [, data] = rows(csv.split('\n').filter(Boolean));
    expect(data[1]).toBe('Nguyễn "The Boss" Hùng');
  });

  it('escapes a name that contains a newline', () => {
    // Newlines in a field must be wrapped in quotes so parsers don't split the row.
    const csv = toCsv([makeRow({ name: 'Line1\nLine2' })]);
    expect(csv).toContain('"Line1\nLine2"');
    // The full CSV should still have exactly two non-empty lines after
    // accounting for the quoted field (the newline is inside the quotes).
    const headerLine = csv.indexOf('\n');
    const afterHeader = csv.slice(headerLine + 1);
    // Quoted multi-line fields wrap the whole value — the data row is one
    // logical row even though it contains a newline inside a quoted field.
    expect(afterHeader.trimEnd()).toBeTruthy();
  });

  it('handles null / undefined name as empty string', () => {
    const csv = toCsv([makeRow({ name: null as unknown as string })]); // defensive null
    const [, data] = rows(csv.split('\n').filter(Boolean));
    expect(data[1]).toBe('');
  });

  it('handles null LTV as empty string', () => {
    const csv = toCsv([makeRow({ ltvVnd: null as unknown as number })]);
    const [, data] = rows(csv.split('\n').filter(Boolean));
    expect(data[2]).toBe('');
  });

  it('produces one data row per input VIP', () => {
    const csv = toCsv([makeRow({ uid: 'a' }), makeRow({ uid: 'b' }), makeRow({ uid: 'c' })]);
    const lines = csv.split('\n').filter(Boolean);
    expect(lines).toHaveLength(4); // header + 3
  });
});
