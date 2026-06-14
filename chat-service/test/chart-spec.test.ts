/**
 * Tests for chart-spec service.
 * - Zod schema accepts the 9 chart types with their per-variant encoding rules.
 * - Rejects malformed specs (missing series on stacked, > 100 rows, etc.).
 * - truncateTopN keeps top N rows by value, lumps the rest into "Other".
 * - buildChartArtifact wires id + truncated flag.
 */
import { describe, it, expect } from 'vitest';
import {
  ChartSpecSchema,
  truncateTopN,
  buildChartArtifact,
  MAX_ROWS,
  PIE_MAX_ROWS,
  HEATMAP_MAX_ROWS,
  TOP_N,
  type ChartSpec,
} from '../src/services/chart-spec.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBarSpec(rows = 3): ChartSpec {
  return {
    type: 'bar',
    title: 'Sales by region',
    data: Array.from({ length: rows }, (_, i) => ({
      region: `R${i}`,
      revenue: 100 - i,
    })),
    encoding: { category: 'region', value: 'revenue' },
  };
}

function makeStackedBarSpec(): ChartSpec {
  return {
    type: 'stacked-bar',
    title: 'Revenue by group/channel',
    data: [
      { group: 'Web', channel: 'a', revenue: 200 },
      { group: 'Web', channel: 'b', revenue: 150 },
      { group: 'IAP', channel: 'appstore', revenue: 300 },
    ],
    encoding: { category: 'group', value: 'revenue', series: 'channel' },
  };
}

// ---------------------------------------------------------------------------
// Schema acceptance
// ---------------------------------------------------------------------------

describe('ChartSpecSchema — accepts valid shapes', () => {
  it.each([
    'bar',
    'horizontal-bar',
    'line',
    'area',
    'scatter',
  ] as const)('accepts a minimal %s spec', (type) => {
    const spec = { ...makeBarSpec(), type };
    expect(() => ChartSpecSchema.parse(spec)).not.toThrow();
  });

  it('accepts a stacked-bar spec when series is present', () => {
    expect(() => ChartSpecSchema.parse(makeStackedBarSpec())).not.toThrow();
  });

  it('accepts a grouped-bar spec when series is present', () => {
    expect(() => ChartSpecSchema.parse({ ...makeStackedBarSpec(), type: 'grouped-bar' })).not.toThrow();
  });

  it('accepts a multi-line spec when series is present', () => {
    const spec: ChartSpec = {
      type: 'multi-line',
      title: 'Daily revenue by channel',
      data: [
        { day: '2026-05-20', channel: 'web', revenue: 100 },
        { day: '2026-05-20', channel: 'iap', revenue: 200 },
        { day: '2026-05-21', channel: 'web', revenue: 110 },
      ],
      encoding: { category: 'day', value: 'revenue', series: 'channel' },
    };
    expect(() => ChartSpecSchema.parse(spec)).not.toThrow();
  });

  it('accepts a funnel spec (ordered steps)', () => {
    const spec: ChartSpec = {
      type: 'funnel',
      title: 'Register → login → recharge',
      data: [
        { step: 'register', users: 1000 },
        { step: 'login', users: 820 },
        { step: 'recharge', users: 140 },
      ],
      encoding: { category: 'step', value: 'users' },
    };
    expect(() => ChartSpecSchema.parse(spec)).not.toThrow();
  });

  it('accepts a heatmap spec when series is present', () => {
    const spec: ChartSpec = {
      type: 'heatmap',
      title: 'Activity by day-of-week × hour',
      data: [
        { hour: 0, dow: 'Mon', sessions: 12 },
        { hour: 1, dow: 'Mon', sessions: 5 },
        { hour: 0, dow: 'Tue', sessions: 9 },
      ],
      encoding: { category: 'hour', value: 'sessions', series: 'dow' },
    };
    expect(() => ChartSpecSchema.parse(spec)).not.toThrow();
  });

  it(`accepts a heatmap above MAX_ROWS (grid cells, own ${HEATMAP_MAX_ROWS}-row cap)`, () => {
    // 7 days × 24 hours = 168 cells — a normal heatmap, over the generic cap.
    const data = Array.from({ length: 168 }, (_, i) => ({
      hour: i % 24,
      dow: `D${Math.floor(i / 24)}`,
      sessions: i,
    }));
    const spec: ChartSpec = {
      type: 'heatmap',
      title: 'Activity grid',
      data,
      encoding: { category: 'hour', value: 'sessions', series: 'dow' },
    };
    expect(data.length).toBeGreaterThan(MAX_ROWS);
    expect(() => ChartSpecSchema.parse(spec)).not.toThrow();
  });

  it('accepts a pie spec with caption', () => {
    const spec: ChartSpec = {
      type: 'pie',
      title: 'Share of revenue',
      caption: 'May 2026, by group',
      data: [
        { group: 'Web', revenue: 3450 },
        { group: 'IAP', revenue: 1810 },
      ],
      encoding: { category: 'group', value: 'revenue' },
    };
    expect(() => ChartSpecSchema.parse(spec)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Schema rejection
// ---------------------------------------------------------------------------

describe('ChartSpecSchema — rejects malformed shapes', () => {
  it('rejects stacked-bar without series', () => {
    const bad = {
      type: 'stacked-bar',
      title: 't',
      data: [{ a: 'x', b: 1 }],
      encoding: { category: 'a', value: 'b' },
    };
    expect(() => ChartSpecSchema.parse(bad)).toThrow();
  });

  it('rejects grouped-bar without series', () => {
    const bad = {
      type: 'grouped-bar',
      title: 't',
      data: [{ a: 'x', b: 1 }],
      encoding: { category: 'a', value: 'b' },
    };
    expect(() => ChartSpecSchema.parse(bad)).toThrow();
  });

  it('rejects multi-line without series', () => {
    const bad = {
      type: 'multi-line',
      title: 't',
      data: [{ a: 'x', b: 1 }],
      encoding: { category: 'a', value: 'b' },
    };
    expect(() => ChartSpecSchema.parse(bad)).toThrow();
  });

  it('rejects heatmap without series', () => {
    const bad = {
      type: 'heatmap',
      title: 't',
      data: [{ a: 'x', b: 1 }],
      encoding: { category: 'a', value: 'b' },
    };
    expect(() => ChartSpecSchema.parse(bad)).toThrow();
  });

  it(`rejects heatmap with more than ${HEATMAP_MAX_ROWS} rows`, () => {
    const bad: ChartSpec = {
      type: 'heatmap',
      title: 't',
      data: Array.from({ length: HEATMAP_MAX_ROWS + 1 }, (_, i) => ({
        x: i % 24,
        y: `r${Math.floor(i / 24)}`,
        v: i,
      })),
      encoding: { category: 'x', value: 'v', series: 'y' },
    };
    expect(() => ChartSpecSchema.parse(bad)).toThrow();
  });

  it(`rejects more than ${MAX_ROWS} data rows`, () => {
    const bad: ChartSpec = {
      type: 'bar',
      title: 't',
      data: Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({ k: `k${i}`, v: i })),
      encoding: { category: 'k', value: 'v' },
    };
    expect(() => ChartSpecSchema.parse(bad)).toThrow();
  });

  it(`rejects pie with more than ${PIE_MAX_ROWS} rows`, () => {
    const bad = {
      type: 'pie',
      title: 't',
      data: Array.from({ length: PIE_MAX_ROWS + 1 }, (_, i) => ({ k: `k${i}`, v: i })),
      encoding: { category: 'k', value: 'v' },
    };
    expect(() => ChartSpecSchema.parse(bad)).toThrow();
  });

  it('rejects empty data', () => {
    const bad = {
      type: 'bar',
      title: 't',
      data: [],
      encoding: { category: 'k', value: 'v' },
    };
    expect(() => ChartSpecSchema.parse(bad)).toThrow();
  });

  it('rejects empty title', () => {
    const bad = {
      type: 'bar',
      title: '',
      data: [{ k: 'a', v: 1 }],
      encoding: { category: 'k', value: 'v' },
    };
    expect(() => ChartSpecSchema.parse(bad)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// truncateTopN
// ---------------------------------------------------------------------------

describe('truncateTopN', () => {
  it('returns spec unchanged when row count is at or below the limit', () => {
    const spec = makeBarSpec(TOP_N);
    const result = truncateTopN(spec);
    expect(result.truncated).toBe(false);
    expect(result.originalRowCount).toBe(TOP_N);
    expect(result.spec.data).toHaveLength(TOP_N);
  });

  it('keeps top (limit-1) rows and lumps remainder into "Other"', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      region: `R${i}`,
      revenue: 100 - i,
    }));
    const spec: ChartSpec = {
      type: 'bar',
      title: 't',
      data: rows,
      encoding: { category: 'region', value: 'revenue' },
    };

    const result = truncateTopN(spec);
    expect(result.truncated).toBe(true);
    expect(result.originalRowCount).toBe(50);
    expect(result.spec.data).toHaveLength(TOP_N);

    // Last row must be the "Other" lump.
    const last = result.spec.data[result.spec.data.length - 1];
    expect(last.region).toBe('Other');

    // Sum preserved (top-29 values + "Other" sum) == original sum.
    const truncatedSum = result.spec.data.reduce(
      (s, r) => s + Number(r.revenue || 0),
      0,
    );
    const originalSum = rows.reduce((s, r) => s + r.revenue, 0);
    expect(truncatedSum).toBe(originalSum);
  });

  it('adds series="Other" to the lump row for stacked-bar', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      group: `G${i}`,
      channel: 'a',
      revenue: 100 - i,
    }));
    const spec: ChartSpec = {
      type: 'stacked-bar',
      title: 't',
      data: rows,
      encoding: { category: 'group', value: 'revenue', series: 'channel' },
    };

    const result = truncateTopN(spec);
    expect(result.truncated).toBe(true);
    const last = result.spec.data[result.spec.data.length - 1];
    expect(last.group).toBe('Other');
    expect(last.channel).toBe('Other');
  });

  it('does not truncate line/area/multi-line — preserves time order', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ day: `2026-06-${i + 1}`, revenue: 40 - i }));
    for (const type of ['line', 'area'] as const) {
      const spec: ChartSpec = {
        type,
        title: 't',
        data: rows,
        encoding: { category: 'day', value: 'revenue' },
      };
      const result = truncateTopN(spec);
      expect(result.truncated).toBe(false);
      expect(result.spec.data).toHaveLength(40);
      // order preserved (no value-sort)
      expect(result.spec.data[0].day).toBe('2026-06-1');
    }
  });

  it('does not truncate pie/donut — pie has its own tighter Zod cap', () => {
    const spec: ChartSpec = {
      type: 'pie',
      title: 't',
      data: Array.from({ length: PIE_MAX_ROWS }, (_, i) => ({ k: `k${i}`, v: i + 1 })),
      encoding: { category: 'k', value: 'v' },
    };

    const result = truncateTopN(spec);
    expect(result.truncated).toBe(false);
    expect(result.spec.data).toHaveLength(PIE_MAX_ROWS);
  });

  it('does not truncate heatmap — dropping rows would punch holes in the grid', () => {
    const rows = Array.from({ length: 168 }, (_, i) => ({
      hour: i % 24,
      dow: `D${Math.floor(i / 24)}`,
      sessions: i,
    }));
    const spec: ChartSpec = {
      type: 'heatmap',
      title: 't',
      data: rows,
      encoding: { category: 'hour', value: 'sessions', series: 'dow' },
    };

    const result = truncateTopN(spec);
    expect(result.truncated).toBe(false);
    expect(result.spec.data).toHaveLength(168);
  });
});

// ---------------------------------------------------------------------------
// buildChartArtifact
// ---------------------------------------------------------------------------

describe('buildChartArtifact', () => {
  it('returns id + truncated flag + originalRowCount', () => {
    const spec = makeBarSpec(3);
    const artifact = buildChartArtifact(spec);
    expect(artifact.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(artifact.truncated).toBe(false);
    expect(artifact.originalRowCount).toBe(3);
    expect(artifact.spec).toEqual(spec);
  });

  it('records truncated=true and original count when truncating', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      region: `R${i}`,
      revenue: 100 - i,
    }));
    const spec: ChartSpec = {
      type: 'bar',
      title: 't',
      data: rows,
      encoding: { category: 'region', value: 'revenue' },
    };

    const artifact = buildChartArtifact(spec);
    expect(artifact.truncated).toBe(true);
    expect(artifact.originalRowCount).toBe(50);
    expect(artifact.spec.data).toHaveLength(TOP_N);
  });

  it('attaches artifactRef when provided', () => {
    const artifact = buildChartArtifact(makeBarSpec(), { artifactRef: 'q-1' });
    expect(artifact.artifactRef).toBe('q-1');
  });
});
