/**
 * Phase 03 — export stream encoding + completion contract (mocked Trino).
 *
 * Mocks streamQuery so the keyset pager can be exercised without a warehouse:
 *  - NDJSON object-per-line + trailing {"_complete":true,"count":N} sentinel,
 *  - CSV header + values + trailing "# complete,N" sentinel,
 *  - multi-page keyset loop terminates on a short page,
 *  - parseFields allowlist guard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Trino client so streamExportPages drains fake pages. The mock returns
// rows based on how many times it's been called (page 1 full, page 2 short).
const pages: unknown[][][] = [];
vi.mock('../src/services/trino-rest-client.js', () => ({
  streamQuery: async function* () {
    const page = pages.shift() ?? [];
    if (page.length) yield { columns: [{ name: 'uid', type: 'varchar' }], rows: page };
  },
}));

// lakehouseConnectorFromEnv needs a host; provide one so it constructs.
process.env.CUBEJS_DB_HOST = 'trino.test';
process.env.PUBLIC_EXPORT_PAGE_SIZE = '2';

import {
  streamExportPages,
  parseFields,
  UnknownFieldError,
  type ResolvedSource,
} from '../src/services/segment-export-stream.js';

const source: ResolvedSource = {
  path: 'table',
  innerSql: "SELECT uid FROM t WHERE segment_id = 's'",
  schema: 'cfm_vn',
};

function abortSignal() {
  return new AbortController().signal;
}

async function collect(format: 'ndjson' | 'csv') {
  let out = '';
  for await (const chunk of streamExportPages(source, {
    format,
    fields: ['uid'],
    cursor: null,
    limit: null,
    signal: abortSignal(),
  })) {
    out += chunk.text;
  }
  return out;
}

describe('parseFields', () => {
  it('defaults to uid', () => expect(parseFields(undefined)).toEqual(['uid']));
  it('keeps uid first + dedupes', () => expect(parseFields('uid,uid')).toEqual(['uid']));
  it('throws on unknown field', () => {
    expect(() => parseFields('ssn')).toThrow(UnknownFieldError);
  });
});

describe('streamExportPages', () => {
  beforeEach(() => {
    pages.length = 0;
  });
  afterEach(() => vi.clearAllMocks());

  it('NDJSON: object-per-line then a _complete sentinel with the true count', async () => {
    // page 1 = 2 rows (full → continue), page 2 = 1 row (short → stop).
    pages.push([['a'], ['b']], [['c']]);
    const out = await collect('ndjson');
    const lines = out.trim().split('\n');
    expect(lines.slice(0, 3)).toEqual(['{"uid":"a"}', '{"uid":"b"}', '{"uid":"c"}']);
    expect(JSON.parse(lines[3])).toEqual({ _complete: true, count: 3 });
  });

  it('CSV: header, values, then a # complete,N sentinel', async () => {
    pages.push([['a'], ['b']], [['c']]);
    const out = await collect('csv');
    expect(out).toBe('uid\na\nb\nc\n# complete,3\n');
  });

  it('emits the sentinel with count 0 for an empty cohort', async () => {
    pages.push([]); // first page empty → short → stop.
    const out = await collect('ndjson');
    expect(JSON.parse(out.trim())).toEqual({ _complete: true, count: 0 });
  });
});
