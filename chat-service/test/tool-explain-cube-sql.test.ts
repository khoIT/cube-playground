/**
 * Tests for the explain_cube_sql tool handler.
 * Mocks cube-meta-cache and globalThis.fetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ToolContext } from '../src/types.js';

vi.mock('../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(),
  extractMemberNames: vi.fn(),
  invalidate: vi.fn(),
}));

import * as cubeMetaCache from '../src/core/cube-meta-cache.js';
import { handler } from '../src/tools/explain-cube-sql.js';

const FIXTURE_META = {
  cubes: [
    {
      name: 'Revenue',
      measures: [{ name: 'Revenue.total', title: 'Total Revenue', type: 'number' }],
      dimensions: [{ name: 'Revenue.createdAt', title: 'Created At', type: 'time' }],
    },
  ],
};

const KNOWN_MEMBERS = new Set(['Revenue.total', 'Revenue.createdAt']);

// Raw SQL Cube would return
const RAW_SQL = 'SELECT SUM(amount) AS "Revenue__total" FROM "public"."orders"';

function makeCtx(): ToolContext {
  return {
    ownerId: 'owner1',
    gameId: 'ptg',
    cubeToken: 'Bearer test-token',
    sessionId: 'sess-1',
    turnId: 'sess-1:1',
    sseEmitter: new EventEmitter(),
  };
}

function mockFetchOk(sql: string) {
  const response = {
    sql: { sql: [sql, []] },
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(response),
  }));
}

function mockFetchError(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }));
}

beforeEach(() => {
  vi.mocked(cubeMetaCache.getMeta).mockResolvedValue(FIXTURE_META);
  vi.mocked(cubeMetaCache.extractMemberNames).mockReturnValue(KNOWN_MEMBERS);
});

describe('explain_cube_sql handler', () => {
  it('returns pretty-printed SQL for a valid query', async () => {
    mockFetchOk(RAW_SQL);

    const result = await handler(
      { query: { measures: ['Revenue.total'] } },
      makeCtx(),
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected ok');
    // sql-formatter adds newlines/indentation — just check key tokens survive
    expect(result.sql).toContain('Revenue__total');
    expect(result.sql).toContain('SELECT');
  });

  it('calls Cube /sql endpoint via POST with Authorization header', async () => {
    mockFetchOk(RAW_SQL);

    await handler({ query: { measures: ['Revenue.total'] } }, makeCtx());

    const fetchMock = vi.mocked(globalThis.fetch as ReturnType<typeof vi.fn>);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/cubejs-api/v1/sql');
    expect((opts as RequestInit).method).toBe('POST');
    expect((opts as RequestInit & { headers: Record<string, string> }).headers['Authorization']).toBe('Bearer test-token');
  });

  it('returns metric_draft for unknown measure', async () => {
    const result = await handler(
      { query: { measures: ['Revenue.fake'] } },
      makeCtx(),
    );

    expect(result).toMatchObject({ ok: false, error: 'metric_draft' });
    if (result.ok) throw new Error('expected error');
    if (result.error !== 'metric_draft') throw new Error('expected metric_draft');
    expect(result.missingRefs).toContain('Revenue.fake');
  });

  it('returns metric_draft for unknown dimension', async () => {
    const result = await handler(
      { query: { measures: ['Revenue.total'], dimensions: ['Revenue.badDim'] } },
      makeCtx(),
    );

    expect(result).toMatchObject({ ok: false, error: 'metric_draft' });
    if (result.ok) throw new Error('expected error');
    if (result.error !== 'metric_draft') throw new Error('expected metric_draft');
    expect(result.missingRefs).toContain('Revenue.badDim');
  });

  it('returns metric_draft for unknown timeDimension', async () => {
    const result = await handler(
      {
        query: {
          measures: ['Revenue.total'],
          timeDimensions: [{ dimension: 'Revenue.badDate', granularity: 'day' }],
        },
      },
      makeCtx(),
    );

    expect(result).toMatchObject({ ok: false, error: 'metric_draft' });
    if (result.ok) throw new Error('expected error');
    if (result.error !== 'metric_draft') throw new Error('expected metric_draft');
    expect(result.missingRefs).toContain('Revenue.badDate');
  });

  it('bypasses the ref guard with force:true', async () => {
    mockFetchOk(RAW_SQL);
    const result = await handler(
      { query: { measures: ['Revenue.fake'] }, force: true },
      makeCtx(),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it('returns cube_error on Cube 5xx', async () => {
    mockFetchError(503, { error: 'Service Unavailable' });

    const result = await handler(
      { query: { measures: ['Revenue.total'] } },
      makeCtx(),
    );

    expect(result).toMatchObject({ ok: false, error: 'cube_error' });
    if (result.ok) throw new Error('expected error');
    if (result.error !== 'cube_error') throw new Error('expected cube_error');
    expect(result.detail.status).toBe(503);
  });

  it('returns cube_error when Cube response has no sql field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sql: {} }),
    }));

    const result = await handler(
      { query: { measures: ['Revenue.total'] } },
      makeCtx(),
    );

    expect(result).toMatchObject({ ok: false, error: 'cube_error' });
  });
});
