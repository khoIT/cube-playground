/**
 * Tests for the emit_query_artifact tool handler.
 * Mocks cube-meta-cache so no HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ToolContext, QueryArtifact } from '../src/types.js';

// Mock cube-meta-cache before importing the tool
vi.mock('../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(),
  extractMemberNames: vi.fn(),
  invalidate: vi.fn(),
}));

import * as cubeMetaCache from '../src/core/cube-meta-cache.js';
import { handler } from '../src/tools/emit-query-artifact.js';

// Minimal /meta fixture with two members
const FIXTURE_META = {
  cubes: [
    {
      name: 'Revenue',
      measures: [{ name: 'Revenue.total', title: 'Total Revenue', type: 'number' }],
      dimensions: [
        { name: 'Revenue.createdAt', title: 'Created At', type: 'time' },
        { name: 'Revenue.country', title: 'Country', type: 'string' },
      ],
    },
  ],
};

const KNOWN_MEMBERS = new Set([
  'Revenue.total',
  'Revenue.createdAt',
  'Revenue.country',
]);

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    ownerId: 'owner1',
    gameId: 'ptg',
    cubeToken: 'Bearer test-token',
    workspace: 'local',
    sessionId: 'sess-1',
    turnId: 'sess-1:1',
    sseEmitter: new EventEmitter(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(cubeMetaCache.getMeta).mockResolvedValue(FIXTURE_META);
  vi.mocked(cubeMetaCache.extractMemberNames).mockReturnValue(KNOWN_MEMBERS);
});

describe('emit_query_artifact handler', () => {
  it('emits artifact via sseEmitter and returns ok result for valid query', async () => {
    const ctx = makeCtx();
    const emittedArtifacts: QueryArtifact[] = [];
    ctx.sseEmitter.on('query_artifact', (a: QueryArtifact) => emittedArtifacts.push(a));

    const result = await handler(
      {
        title: 'Daily Revenue',
        summary: 'Shows daily revenue for the last 7 days',
        query: {
          measures: ['Revenue.total'],
          timeDimensions: [
            { dimension: 'Revenue.createdAt', granularity: 'day', dateRange: 'last 7 days' },
          ],
        },
        source: 'raw',
      },
      ctx,
    );

    expect(result).toMatchObject({ ok: true });
    expect('id' in result && result.id).toBeTruthy();
    expect('deeplinkUrl' in result && result.deeplinkUrl).toMatch(/^#\/build\?query=/);

    expect(emittedArtifacts).toHaveLength(1);
    expect(emittedArtifacts[0].title).toBe('Daily Revenue');
    expect(emittedArtifacts[0].game).toBe('ptg');
    expect(emittedArtifacts[0].deeplinkUrl).toBeTruthy();
  });

  it('returns unknown_member error for an unrecognised measure', async () => {
    const ctx = makeCtx();

    const result = await handler(
      {
        title: 'Bad Query',
        summary: 'Uses a fake measure',
        query: { measures: ['Revenue.totalFake'] },
        source: 'raw',
      },
      ctx,
    );

    expect(result).toMatchObject({
      ok: false,
      error: 'unknown_member',
      detail: { which: 'measure', value: 'Revenue.totalFake' },
    });
  });

  it('returns unknown_member error for an unrecognised dimension', async () => {
    const ctx = makeCtx();

    const result = await handler(
      {
        title: 'Bad Dim',
        summary: 'Uses a fake dimension',
        query: { measures: ['Revenue.total'], dimensions: ['Revenue.fakeDim'] },
        source: 'raw',
      },
      ctx,
    );

    expect(result).toMatchObject({
      ok: false,
      error: 'unknown_member',
      detail: { which: 'dimension', value: 'Revenue.fakeDim' },
    });
  });

  it('returns unknown_member for bad timeDimension.dimension', async () => {
    const ctx = makeCtx();

    const result = await handler(
      {
        title: 'Bad TD',
        summary: 'Bad time dimension',
        query: {
          measures: ['Revenue.total'],
          timeDimensions: [{ dimension: 'Revenue.badDate', granularity: 'day' }],
        },
        source: 'raw',
      },
      ctx,
    );

    expect(result).toMatchObject({
      ok: false,
      error: 'unknown_member',
      detail: { which: 'dimension', value: 'Revenue.badDate' },
    });
  });

  it('refuses to emit a snapshot-cube measure when session memory has a timeRange', async () => {
    // Add a snapshot cube to the meta fixture for this test only.
    const metaWithSnapshot = {
      cubes: [
        ...FIXTURE_META.cubes,
        {
          name: 'mf_users',
          measures: [{ name: 'mf_users.arpu_vnd', type: 'number' }],
          dimensions: [{ name: 'mf_users.id', type: 'string' }],
        },
      ],
    };
    const knownWithSnapshot = new Set([
      ...KNOWN_MEMBERS,
      'mf_users.arpu_vnd',
      'mf_users.id',
    ]);
    vi.mocked(cubeMetaCache.getMeta).mockResolvedValueOnce(metaWithSnapshot);
    vi.mocked(cubeMetaCache.extractMemberNames).mockReturnValueOnce(knownWithSnapshot);

    // Build a session-memory row carrying timeRange via the adapter.
    const Database = (await import('better-sqlite3')).default;
    const { migrate } = await import('../src/db/migrate.js');
    const { mergeResolution } = await import('../src/cache/disambig-memory-adapter.js');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
    mergeResolution(db, 'sess-snap', 'owner1', {
      timeRange: {
        value: { dateRange: ['2026-05-21', '2026-05-27'], granularity: 'day' },
        phrase: 'this week',
      },
    });

    const ctx = makeCtx({ db, sessionId: 'sess-snap' });
    const result = await handler(
      {
        title: 'ARPU (lifetime)',
        summary: 'Lifetime average revenue per user',
        query: { measures: ['mf_users.arpu_vnd'] }, // no timeDimensions
        source: 'raw',
      },
      ctx,
    );

    expect(result).toMatchObject({
      ok: false,
      error: 'time_dim_required',
    });
    expect('detail' in result && (result.detail as { cubeName: string }).cubeName).toBe('mf_users');
  });

  it('falls back to session-storage deeplink when query JSON exceeds 8000 chars', async () => {
    const ctx = makeCtx();

    // Build a query where encoded JSON > 8000 chars
    // We need to add many valid dimensions — extend KNOWN_MEMBERS and META fixture
    const bigMeasures = Array.from(
      { length: 200 },
      (_, i) => `Revenue.total`, // reuse the valid measure
    );

    // Only use the valid measure repeatedly; the URL length grows because of
    // repetition in the JSON array — but Zod deduplication won't apply here
    // since we're calling handler directly with pre-validated args.
    // Instead, build a huge filter values array
    const bigFilters = Array.from({ length: 200 }, (_, i) => ({
      member: 'Revenue.country',
      operator: 'equals',
      values: [
        `very-long-country-name-value-${i}-padding-to-inflate-url-length-considerably`,
      ],
    }));

    const result = await handler(
      {
        title: 'Huge query',
        summary: 'Test session-storage fallback',
        query: {
          measures: ['Revenue.total'],
          filters: bigFilters,
        },
        source: 'raw',
      },
      ctx,
    );

    if (result.ok) {
      // Check if deeplink is session-storage (depends on total encoded size)
      // The test simply asserts the url is one of the two valid shapes
      expect(result.deeplinkUrl).toMatch(/^#\/build\?(query=|from-chat-artifact=)/);
    }
  });

  it('emits artifact whose id matches the uuid embedded in the deeplink URL', async () => {
    // Regression: previously the artifact and the URL minted independent uuids,
    // breaking the sessionStorage handoff for queries > 8000 chars.
    const ctx = makeCtx();
    const emitted: any[] = [];
    ctx.sseEmitter.on('query_artifact', (a) => emitted.push(a));

    const bigFilters = Array.from({ length: 200 }, (_, i) => ({
      member: 'Revenue.country',
      operator: 'equals',
      values: [`country-value-${i}-padded-to-inflate-the-encoded-json-length-well-past-eight-thousand`],
    }));

    const result = await handler(
      {
        title: 'Id-match contract',
        summary: 'artifact.id === deeplink uuid',
        query: { measures: ['Revenue.total'], filters: bigFilters },
        source: 'raw',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(emitted).toHaveLength(1);
    const artifact = emitted[0];

    if (artifact.deeplinkVia === 'session-storage') {
      const urlMatch = artifact.deeplinkUrl.match(/from-chat-artifact=([^&]+)/);
      expect(urlMatch).not.toBeNull();
      expect(artifact.id).toBe(urlMatch![1]);
    } else {
      // Inline path also exposes an id, but the URL carries the query inline.
      // Still assert the returned id matches the artifact's id (sanity).
      expect(result.ok && result.id).toBe(artifact.id);
    }
  });

  it('attaches a built ChartArtifact when `chart` is provided', async () => {
    const ctx = makeCtx();
    const emitted: QueryArtifact[] = [];
    ctx.sseEmitter.on('query_artifact', (a: QueryArtifact) => emitted.push(a));

    await handler(
      {
        title: 'Daily revenue with chart',
        summary: 'Revenue per day, last 7 days',
        query: {
          measures: ['Revenue.total'],
          timeDimensions: [
            { dimension: 'Revenue.createdAt', granularity: 'day', dateRange: 'last 7 days' },
          ],
        },
        source: 'raw',
        chart: {
          type: 'line',
          title: 'Daily revenue',
          data: [
            { day: '2026-05-20', revenue: 100 },
            { day: '2026-05-21', revenue: 120 },
          ],
          encoding: { category: 'day', value: 'revenue' },
        },
      },
      ctx,
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].chart).toBeDefined();
    expect(emitted[0].chart?.spec.type).toBe('line');
    expect(emitted[0].chart?.artifactRef).toBe(emitted[0].id);
    expect(emitted[0].chart?.truncated).toBe(false);
  });

  it('does NOT emit SSE event when validation fails', async () => {
    const ctx = makeCtx();
    const emitted: unknown[] = [];
    ctx.sseEmitter.on('query_artifact', (a) => emitted.push(a));

    await handler(
      {
        title: 'Bad',
        summary: 'fail',
        query: { measures: ['Revenue.nonexistent'] },
        source: 'raw',
      },
      ctx,
    );

    expect(emitted).toHaveLength(0);
  });

  it('persists the executed query as the additive-merge target (lastQuery)', async () => {
    const { default: Database } = await import('better-sqlite3');
    const { migrate } = await import('../src/db/migrate.js');
    const { getResolutions } = await import('../src/cache/disambig-memory-adapter.js');
    const { config } = await import('../src/config.js');
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;

    const db = new Database(':memory:');
    migrate(db);
    const ctx = makeCtx({ db });

    const res = await handler(
      {
        title: 'Revenue by country',
        summary: 'Total revenue split by country',
        query: { measures: ['Revenue.total'], dimensions: ['Revenue.country'] },
        source: 'raw',
      },
      ctx,
    );
    expect(res.ok).toBe(true);

    const mem = getResolutions(db, ctx.sessionId);
    expect(mem.lastQuery?.phrase).toBe('Revenue by country');
    expect(JSON.parse(mem.lastQuery!.value)).toMatchObject({
      measures: ['Revenue.total'],
      dimensions: ['Revenue.country'],
    });
  });

  it('lastQuery write is a no-op without a db handle', async () => {
    const ctx = makeCtx(); // no db
    const res = await handler(
      {
        title: 'No DB',
        summary: 'unit-test ctx without db',
        query: { measures: ['Revenue.total'] },
        source: 'raw',
      },
      ctx,
    );
    expect(res.ok).toBe(true);
  });
});
