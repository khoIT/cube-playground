/**
 * Unit tests for propose_segment handler — covers the three hard-case
 * predicate builders and the critical guardrails:
 *
 *   threshold  — plain gte leaf, no cutoff call needed
 *   percentile — percentileGte leaf, cutoff resolved, disclosures present
 *   top_n      — N→percentile conversion, two cutoff calls, rolling disclosure
 *
 * Guardrails:
 *   - missing threshold_value → error
 *   - percentile with no `over` → error (unscoped is silently wrong)
 *   - top_n with no `over`     → error
 *   - invalid over (empty table/column) → error
 *   - cutoff server failure    → error propagated
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { EventEmitter } from 'node:events';
import { handler } from '../src/tools/propose-segment.js';
import type { SegmentableMeasure } from '../src/tools/get-segmentable-measures.js';
import type { ToolContext } from '../src/types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the server-client so no real HTTP calls are made.
vi.mock('../src/services/server-client.js', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  ServerClientError: class ServerClientError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown) {
      super(`HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  },
}));

import * as serverClient from '../src/services/server-client.js';
const mockPostJson = serverClient.postJson as MockedFunction<typeof serverClient.postJson>;

// Mock only getMeta (network) — keep extractMeasureNames real so the measure-vs-
// dimension distinction in kind=query is exercised end to end. Default resolves
// undefined → empty measure set → prior behaviour for tests that don't set it.
vi.mock('../src/core/cube-meta-cache.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/core/cube-meta-cache.js')>();
  return { ...actual, getMeta: vi.fn() };
});
import * as cubeMetaCache from '../src/core/cube-meta-cache.js';
const mockGetMeta = cubeMetaCache.getMeta as MockedFunction<typeof cubeMetaCache.getMeta>;

// Reset the mocks before every test so call counts don't bleed between tests.
beforeEach(() => {
  mockPostJson.mockReset();
  mockGetMeta.mockReset();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MEASURE_WITH_OVER: SegmentableMeasure = {
  concept: 'ltv_vnd',
  label: 'Lifetime Value (VND)',
  dimension: 'mf_users.ltv_vnd',
  window: 'lifetime',
  currency: 'VND',
  over: {
    table: 'stag_iceberg.khoitn.mf_users_ltv',
    column: 'ltv_vnd',
    filter: {
      kind: 'leaf',
      id: 'pop-filter-1',
      member: 'mf_users.recharge_count',
      type: 'number',
      op: 'gt',
      values: [0],
    },
  },
};

const MEASURE_WITHOUT_OVER: SegmentableMeasure = {
  concept: 'dau',
  label: 'DAU',
  dimension: 'mf_users.dau',
  window: '1d',
};

const MEASURE_INVALID_OVER: SegmentableMeasure = {
  concept: 'bad_measure',
  label: 'Bad',
  dimension: 'mf_users.bad',
  over: { table: '', column: '' }, // empty — should be rejected
};

function makeCtx(): { ctx: ToolContext; emitter: EventEmitter } {
  const emitter = new EventEmitter();
  const ctx: ToolContext = {
    ownerId: 'test-owner',
    gameId: 'cfm_vn',
    cubeToken: 'tok',
    workspace: 'local',
    sessionId: 'sess-1',
    turnId: 'turn-1',
    sseEmitter: emitter,
  };
  return { ctx, emitter };
}

// ---------------------------------------------------------------------------
// Threshold path
// ---------------------------------------------------------------------------

describe('propose_segment — threshold', () => {
  it('emits a segment_proposal with a plain gte leaf', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));

    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'High spenders',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        threshold_value: 1_000_000,
        suggested_visibility: 'personal',
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(proposals).toHaveLength(1);

    const proposal = proposals[0] as Record<string, unknown>;
    expect(proposal.type).toBe('segment_proposal');
    expect(proposal.name).toBe('High spenders');
    expect(proposal.cube).toBe('mf_users');

    const tree = proposal.predicate_tree as { kind: string; op: string; children: unknown[] };
    expect(tree.kind).toBe('group');
    expect(tree.op).toBe('AND');
    expect(tree.children).toHaveLength(1);

    const leaf = tree.children[0] as { kind: string; op: string; values: unknown[] };
    expect(leaf.kind).toBe('leaf');
    expect(leaf.op).toBe('gte');
    expect(leaf.values).toEqual([1_000_000]);
  });

  it('emits an lte (upper-bound) leaf when threshold_op="lte"', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));

    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Low spenders',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        threshold_value: 1_000,
        threshold_op: 'lte',
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    const proposal = proposals[0] as Record<string, unknown>;
    const tree = proposal.predicate_tree as { children: { op: string; values: unknown[] }[] };
    expect(tree.children[0].op).toBe('lte');
    expect(tree.children[0].values).toEqual([1_000]);
    // Disclosure copy reflects the upper-bound direction (≤, not ≥).
    const disclosures = proposal.disclosures as string[];
    expect(disclosures.some((d) => d.includes('≤'))).toBe(true);
    expect(disclosures.some((d) => d.includes('≥'))).toBe(false);
  });

  it('defaults to a gte leaf when threshold_op is omitted', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));

    await handler(
      {
        game_id: 'cfm_vn',
        name: 'Default direction',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        threshold_value: 42,
        language: 'en',
      },
      ctx,
    );

    const proposal = proposals[0] as Record<string, unknown>;
    const tree = proposal.predicate_tree as { children: { op: string }[] };
    expect(tree.children[0].op).toBe('gte');
  });

  it('emits a two-leaf range (gte..lte) when threshold_value_max is set', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));

    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Mid spenders',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        threshold_value: 500,
        threshold_value_max: 1_000,
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    const proposal = proposals[0] as Record<string, unknown>;
    const tree = proposal.predicate_tree as { children: { op: string; values: unknown[] }[] };
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].op).toBe('gte');
    expect(tree.children[0].values).toEqual([500]);
    expect(tree.children[1].op).toBe('lte');
    expect(tree.children[1].values).toEqual([1_000]);
    // Disclosure reads as a band (X ≤ label ≤ Y).
    const disclosures = proposal.disclosures as string[];
    expect(disclosures.some((d) => d.includes('500') && d.includes('1000') && d.includes('≤'))).toBe(true);
  });

  it('rejects a range whose max is below the lower bound', async () => {
    const { ctx } = makeCtx();
    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Bad range',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        threshold_value: 1_000,
        threshold_value_max: 500,
        language: 'en',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  it('range ANDs with additional_filters (more than two leaves)', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));

    await handler(
      {
        game_id: 'cfm_vn',
        name: 'Mid spenders in VN',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        threshold_value: 500,
        threshold_value_max: 1_000,
        additional_filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
        language: 'en',
      },
      ctx,
    );

    const proposal = proposals[0] as Record<string, unknown>;
    const tree = proposal.predicate_tree as { children: { op: string }[] };
    expect(tree.children).toHaveLength(3);
    expect(tree.children.map((c) => c.op)).toEqual(['gte', 'lte', 'equals']);
  });

  it('returns error when threshold_value is missing', async () => {
    const { ctx } = makeCtx();
    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Test',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        // threshold_value omitted
        language: 'en',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('missing_threshold_value');
  });

  it('does not call postJson (no cutoff needed for threshold)', async () => {
    const { ctx } = makeCtx();
    mockPostJson.mockClear();

    await handler(
      {
        game_id: 'cfm_vn',
        name: 'Test',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        threshold_value: 500_000,
        language: 'en',
      },
      ctx,
    );

    // No CUTOFF round-trip for threshold/query (a preview-count POST is allowed).
    expect(mockPostJson).not.toHaveBeenCalledWith(
      '/api/segments/resolve-cutoff',
      expect.anything(),
      expect.anything(),
    );
  });

  it('surfaces the dry-run preview count as estCount when available', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));
    // The preview-count POST resolves a real size → it flows into the proposal.
    mockPostJson.mockResolvedValueOnce({ ok: true, estCount: 777 } as never);

    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Sized threshold',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        threshold_value: 500_000,
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.estCount).toBe(777);
    const proposal = proposals[0] as { resolved: { estCount: number }; disclosures: string[] };
    expect(proposal.resolved.estCount).toBe(777);
    expect(proposal.disclosures.some((d) => d.includes('777'))).toBe(true);
    // It used the preview-count path, not the cutoff path.
    expect(mockPostJson).toHaveBeenCalledWith(
      '/api/segments/preview-count',
      expect.objectContaining({ cube: expect.any(String) }),
      ctx,
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('falls back to estCount 0 when the preview count is unavailable', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));
    // Count endpoint errors → fetchPreviewCount swallows to null → estCount 0.
    mockPostJson.mockRejectedValueOnce(new Error('fetch failed'));

    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Unsized threshold',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        threshold_value: 500_000,
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.estCount).toBe(0);
    const proposal = proposals[0] as { resolved: { estCount: number } };
    expect(proposal.resolved.estCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Percentile path
// ---------------------------------------------------------------------------

describe('propose_segment — percentile', () => {
  it('emits percentileGte leaf with resolved cutoff + estCount', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));

    mockPostJson.mockResolvedValueOnce({
      cutoff: 744_000,
      populationCount: 238_400,
      estCount: 59_600,
    });

    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Top 25% spenders',
        kind: 'percentile',
        measure: MEASURE_WITH_OVER,
        percentile_top_pct: 25,
        suggested_visibility: 'shared',
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estCount).toBe(59_600);

    expect(proposals).toHaveLength(1);
    const proposal = proposals[0] as Record<string, unknown>;

    // Resolved block
    const resolved = proposal.resolved as {
      cutoff: number;
      estCount: number;
      populationCount: number;
      population: string;
    };
    expect(resolved.cutoff).toBe(744_000);
    expect(resolved.estCount).toBe(59_600);
    expect(resolved.populationCount).toBe(238_400);

    // Predicate leaf shape
    const tree = proposal.predicate_tree as { kind: string; children: unknown[] };
    const leaf = tree.children[0] as { op: string; values: unknown[] };
    expect(leaf.op).toBe('percentileGte');
    // p = 100 - 25 = 75
    const pv = leaf.values[0] as { p: number };
    expect(pv.p).toBe(75);

    // Disclosures present
    const disclosures = proposal.disclosures as string[];
    expect(disclosures.length).toBeGreaterThan(0);
    // Must mention rolling semantics
    expect(disclosures.some((d) => d.toLowerCase().includes('rolling') || d.toLowerCase().includes('re-resolved'))).toBe(true);
  });

  it('calls /resolve-cutoff exactly once with gte:true', async () => {
    const { ctx } = makeCtx();
    mockPostJson.mockResolvedValueOnce({ cutoff: 500_000, populationCount: 100_000, estCount: 25_000 });

    await handler(
      {
        game_id: 'cfm_vn',
        name: 'Top 25%',
        kind: 'percentile',
        measure: MEASURE_WITH_OVER,
        percentile_top_pct: 25,
        language: 'en',
      },
      ctx,
    );

    expect(mockPostJson).toHaveBeenCalledOnce();
    const [path, body] = mockPostJson.mock.calls[0] as [string, Record<string, unknown>, ToolContext];
    expect(path).toBe('/api/segments/resolve-cutoff');
    expect(body.gte).toBe(true);
    expect(body.p).toBe(75);
    expect(body.over).toBe(MEASURE_WITH_OVER.over);
  });

  it('returns error when measure has no over (unscoped percentile guard)', async () => {
    const { ctx } = makeCtx();
    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Top 25% DAU',
        kind: 'percentile',
        measure: MEASURE_WITHOUT_OVER,
        percentile_top_pct: 25,
        language: 'en',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('missing_population');
  });

  it('returns error when percentile_top_pct is missing', async () => {
    const { ctx } = makeCtx();
    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Top ?%',
        kind: 'percentile',
        measure: MEASURE_WITH_OVER,
        language: 'en',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('missing_percentile');
  });

  it('propagates cutoff server failure', async () => {
    const { ctx } = makeCtx();
    const { ServerClientError } = await import('../src/services/server-client.js');
    mockPostJson.mockRejectedValueOnce(new ServerClientError(500, { error: 'internal' }));

    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Top 10%',
        kind: 'percentile',
        measure: MEASURE_WITH_OVER,
        percentile_top_pct: 10,
        language: 'en',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('cutoff_failed');
  });

  it('includes Vietnamese disclosures when language=vi', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));
    mockPostJson.mockResolvedValueOnce({ cutoff: 744_000, populationCount: 200_000, estCount: 50_000 });

    await handler(
      {
        game_id: 'cfm_vn',
        name: 'Top 25% VN',
        kind: 'percentile',
        measure: MEASURE_WITH_OVER,
        percentile_top_pct: 25,
        language: 'vi',
      },
      ctx,
    );

    const proposal = proposals[0] as Record<string, unknown>;
    const disclosures = proposal.disclosures as string[];
    // Vietnamese disclosure must contain Vietnamese characters
    const hasVi = disclosures.some((d) => /[àáạảãăắặẳẵâấậẩẫèéẹẻẽêếệểễìíịỉĩòóọỏõôốộổỗơớợởỡùúụủũưứựửữỳýỵỷỹđ]/i.test(d));
    expect(hasVi).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Top-N path
// ---------------------------------------------------------------------------

describe('propose_segment — top_n', () => {
  it('converts top-N to a percentile and emits percentileGte leaf', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));

    // Probe call returns population size
    mockPostJson.mockResolvedValueOnce({ cutoff: 0, populationCount: 1000, estCount: 500 });
    // Second call resolves the derived percentile
    mockPostJson.mockResolvedValueOnce({ cutoff: 900_000, populationCount: 1000, estCount: 100 });

    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Top 100 spenders',
        kind: 'top_n',
        measure: MEASURE_WITH_OVER,
        top_n: 100,
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(true);

    // Two cutoff calls: probe + resolve
    expect(mockPostJson).toHaveBeenCalledTimes(2);

    const proposal = proposals[0] as Record<string, unknown>;
    const tree = proposal.predicate_tree as { kind: string; children: unknown[] };
    const leaf = tree.children[0] as { op: string; values: unknown[] };
    expect(leaf.op).toBe('percentileGte');
    // p = 100 * (1 - 100/1000) = 90
    const pv = leaf.values[0] as { p: number };
    expect(pv.p).toBeCloseTo(90, 1);

    // Disclosures mention rolling / drift
    const disclosures = proposal.disclosures as string[];
    expect(disclosures.some((d) => d.toLowerCase().includes('drift') || d.toLowerCase().includes('rolling'))).toBe(true);
  });

  it('returns error when top_n measure has no over', async () => {
    const { ctx } = makeCtx();
    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Top 100',
        kind: 'top_n',
        measure: MEASURE_WITHOUT_OVER,
        top_n: 100,
        language: 'en',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('missing_population');
  });

  it('returns error when top_n is missing', async () => {
    const { ctx } = makeCtx();
    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Top ?',
        kind: 'top_n',
        measure: MEASURE_WITH_OVER,
        language: 'en',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('missing_top_n');
  });
});

// ---------------------------------------------------------------------------
// Guardrail: invalid over spec
// ---------------------------------------------------------------------------

describe('propose_segment — invalid_over guardrail', () => {
  it('rejects a measure whose over has empty table/column', async () => {
    const { ctx } = makeCtx();
    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Bad measure',
        kind: 'percentile',
        measure: MEASURE_INVALID_OVER,
        percentile_top_pct: 25,
        language: 'en',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_over');
  });
});

// ---------------------------------------------------------------------------
// kind='query' — plain dimension filters from an explored Cube query
// ---------------------------------------------------------------------------

describe('propose_segment — kind=query', () => {
  it('translates plain dimension filters to a segment_proposal with a predicate tree', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));

    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'VN payers',
        kind: 'query',
        cube: 'mf_users',
        filters: [
          { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
          { member: 'mf_users.user_type', operator: 'equals', values: ['payer'] },
        ],
        suggested_visibility: 'personal',
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estCount).toBe(0);

    expect(proposals).toHaveLength(1);
    const proposal = proposals[0] as Record<string, unknown>;
    expect(proposal.type).toBe('segment_proposal');
    expect(proposal.name).toBe('VN payers');
    expect(proposal.cube).toBe('mf_users');

    // No cutoff for plain predicates
    const resolved = proposal.resolved as { cutoff?: number; estCount: number; population: string };
    expect(resolved.cutoff).toBeUndefined();
    expect(resolved.estCount).toBe(0);

    // Predicate tree: AND group with two leaves
    const tree = proposal.predicate_tree as { kind: string; op: string; children: unknown[] };
    expect(tree.kind).toBe('group');
    expect(tree.op).toBe('AND');
    expect(tree.children).toHaveLength(2);

    // Disclosures present, no cutoff server call made
    const disclosures = proposal.disclosures as string[];
    expect(disclosures.length).toBeGreaterThan(0);
    // No CUTOFF round-trip for threshold/query (a preview-count POST is allowed).
    expect(mockPostJson).not.toHaveBeenCalledWith(
      '/api/segments/resolve-cutoff',
      expect.anything(),
      expect.anything(),
    );
  });

  it('returns ok:false when a measure filter is present (guardrail)', async () => {
    const { ctx } = makeCtx();
    // Passing a measure member in the filter set — cubeQueryToPredicateTree
    // rejects this when the measure is known; here we pass it without a
    // measureNames set so the translator can't detect it automatically. Instead,
    // the translate call succeeds (unknown member treated as dimension).
    // Test the important guardrail: time-leaf inside OR is always rejected.
    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Bad query segment',
        kind: 'query',
        cube: 'mf_users',
        filters: [
          {
            or: [
              { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
              { member: 'mf_users.register_date', operator: 'inDateRange', values: ['2024-01-01', '2024-12-31'] },
            ],
          },
        ],
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_filters');
      // Reason from the translator should be embedded in detail
      expect(result.detail).toContain('time_leaf_in_or');
    }
  });

  it('rejects a measure smuggled into kind=query, naming the corrected call', async () => {
    const { ctx } = makeCtx();
    // Meta resolves with ltv_vnd as a MEASURE of mf_users — the guard must fire.
    mockGetMeta.mockResolvedValueOnce({
      cubes: [
        {
          name: 'mf_users',
          measures: [{ name: 'mf_users.ltv_vnd', type: 'number' }],
          dimensions: [{ name: 'mf_users.country', type: 'string' }],
        },
      ],
    });

    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Measure-in-query (illegal)',
        kind: 'query',
        cube: 'mf_users',
        filters: [{ member: 'mf_users.ltv_vnd', operator: 'gte', values: ['200000'] }],
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_filters');
      expect(result.detail).toContain('measure_filter');
      // The hint steers the model to the threshold path rather than a retry.
      expect(result.detail).toContain('threshold');
    }
  });

  it('still accepts a dimension filter when meta is available (no false positive)', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));
    mockGetMeta.mockResolvedValueOnce({
      cubes: [
        {
          name: 'mf_users',
          measures: [{ name: 'mf_users.ltv_vnd', type: 'number' }],
          dimensions: [{ name: 'mf_users.country', type: 'string' }],
        },
      ],
    });

    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'VN dimension filter',
        kind: 'query',
        cube: 'mf_users',
        filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(proposals).toHaveLength(1);
  });

  it('returns ok:false when filters is missing', async () => {
    const { ctx } = makeCtx();
    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'No filters',
        kind: 'query',
        cube: 'mf_users',
        language: 'en',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('missing_filters');
  });

  it('returns ok:false when cube is missing', async () => {
    const { ctx } = makeCtx();
    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'No cube',
        kind: 'query',
        filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
        language: 'en',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('missing_cube');
  });

  it('includes Vietnamese disclosures when language=vi', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));

    await handler(
      {
        game_id: 'cfm_vn',
        name: 'VN payers VI',
        kind: 'query',
        cube: 'mf_users',
        filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
        language: 'vi',
      },
      ctx,
    );

    expect(proposals).toHaveLength(1);
    const proposal = proposals[0] as Record<string, unknown>;
    const disclosures = proposal.disclosures as string[];
    const hasVi = disclosures.some((d) =>
      /[àáạảãăắặẳẵâấậẩẫèéẹẻẽêếệểễìíịỉĩòóọỏõôốộổỗơớợởỡùúụủũưứựửữỳýỵỷỹđ]/i.test(d),
    );
    expect(hasVi).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Compound predicates — additional_filters AND-ed onto the main leaf
// ---------------------------------------------------------------------------

describe('propose_segment — additional_filters (compound)', () => {
  it('ANDs a never-payer condition onto a percentile proposal', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));

    mockPostJson.mockResolvedValueOnce({ cutoff: 120, populationCount: 1_000_000, estCount: 250_000 });

    const ACTIVE_DAYS: SegmentableMeasure = {
      concept: 'active_days',
      label: 'Total active days (lifetime)',
      dimension: 'mf_users.total_active_days',
      window: 'lifetime',
      over: { table: 'game_integration.jus_vn.mf_users', column: 'ingame_total_active_days' },
    };

    const result = await handler(
      {
        game_id: 'jus_vn',
        name: 'High-Engagement Never-Payers',
        kind: 'percentile',
        measure: ACTIVE_DAYS,
        percentile_top_pct: 25,
        additional_filters: [{ member: 'mf_users.ltv_vnd', operator: 'equals', values: [0] }],
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    const proposal = proposals[0] as Record<string, unknown>;
    const tree = proposal.predicate_tree as { op: string; children: Array<{ op: string; member: string; values: unknown[] }> };
    expect(tree.op).toBe('AND');
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].op).toBe('percentileGte');
    expect(tree.children[1]).toMatchObject({ member: 'mf_users.ltv_vnd', op: 'equals', values: [0] });

    // Disclosure names the extra condition.
    const disclosures = proposal.disclosures as string[];
    expect(disclosures.some((d) => d.includes('Also requires') && d.includes('mf_users.ltv_vnd'))).toBe(true);
  });

  it('ANDs extra conditions onto a threshold proposal (no cutoff call)', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: unknown[] = [];
    emitter.on('segment_proposal', (p) => proposals.push(p));

    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Big spenders in VN',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        threshold_value: 1_000_000,
        additional_filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
        language: 'en',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    // No CUTOFF round-trip for threshold/query (a preview-count POST is allowed).
    expect(mockPostJson).not.toHaveBeenCalledWith(
      '/api/segments/resolve-cutoff',
      expect.anything(),
      expect.anything(),
    );
    const proposal = proposals[0] as Record<string, unknown>;
    const tree = proposal.predicate_tree as { children: Array<{ op: string; member: string }> };
    expect(tree.children).toHaveLength(2);
    expect(tree.children[1]).toMatchObject({ member: 'mf_users.country', op: 'equals' });
  });

  it('rejects an additional_filter member on a different cube', async () => {
    const { ctx } = makeCtx();
    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'Cross-cube',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        threshold_value: 100,
        additional_filters: [{ member: 'other_cube.foo', operator: 'equals', values: [1] }],
        language: 'en',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_filters');
  });

  it('rejects an additional_filter that needs a value but has none', async () => {
    const { ctx } = makeCtx();
    const result = await handler(
      {
        game_id: 'cfm_vn',
        name: 'No value',
        kind: 'threshold',
        measure: MEASURE_WITH_OVER,
        threshold_value: 100,
        additional_filters: [{ member: 'mf_users.ltv_vnd', operator: 'equals', values: [] }],
        language: 'en',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_filters');
  });
});
