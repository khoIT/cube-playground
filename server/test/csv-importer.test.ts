import { describe, it, expect } from 'vitest';
import { parseUidCsv, MAX_ROWS } from '../src/services/csv-importer.js';

describe('parseUidCsv', () => {
  it('parses a happy-path single-column file', () => {
    const out = parseUidCsv('uid\nabc\ndef\nghi\n');
    expect(out.uids).toEqual(['abc', 'def', 'ghi']);
    expect(out.errors).toEqual([]);
    expect(out.truncated).toBe(false);
  });

  it('detects header and skips it', () => {
    const out = parseUidCsv('user_id\n100\n200\n');
    expect(out.uids).toEqual(['100', '200']);
  });

  it('treats headerless CSV as data', () => {
    const out = parseUidCsv('100\n200\n300\n');
    expect(out.uids).toEqual(['100', '200', '300']);
  });

  it('dedupes preserving first-occurrence order', () => {
    const out = parseUidCsv('a\nb\na\nc\nb\n');
    expect(out.uids).toEqual(['a', 'b', 'c']);
  });

  it('strips BOM', () => {
    const bom = String.fromCharCode(0xfeff);
    const out = parseUidCsv(bom + 'user_id\n42\n');
    expect(out.uids).toEqual(['42']);
  });

  it('normalises CRLF to LF', () => {
    const out = parseUidCsv('a\r\nb\r\nc');
    expect(out.uids).toEqual(['a', 'b', 'c']);
  });

  it('rejects rows with non-ASCII characters', () => {
    const out = parseUidCsv('user_id\nokay\nrow_with_diacritic_e_é\n');
    expect(out.uids).toEqual(['okay']);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].reason).toContain('non-printable');
  });

  it('rejects values exceeding 256 chars', () => {
    const longValue = 'x'.repeat(300);
    const out = parseUidCsv('user_id\nshort\n' + longValue + '\n');
    expect(out.uids).toEqual(['short']);
    expect(out.errors[0].reason).toContain('exceeds');
  });

  it('rejects binary input containing null bytes', () => {
    const NUL = String.fromCharCode(0);
    const out = parseUidCsv('user_id\nokay\n' + NUL + 'binary\n');
    expect(out.uids).toEqual([]);
    expect(out.errors[0].reason).toContain('binary');
  });

  it('truncates beyond MAX_ROWS', () => {
    const big = ['user_id', ...Array.from({ length: MAX_ROWS + 200 }, (_, i) => 'uid_' + i)].join('\n');
    const out = parseUidCsv(big);
    expect(out.uids).toHaveLength(MAX_ROWS);
    expect(out.truncated).toBe(true);
  });

  it('accepts buffer input', () => {
    const buf = Buffer.from('user_id\nabc\n');
    const out = parseUidCsv(buf);
    expect(out.uids).toEqual(['abc']);
  });
});
