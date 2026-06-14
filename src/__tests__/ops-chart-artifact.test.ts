/**
 * ops-chart-artifact — verifies the Ops Overview → ChartArtifact adapters build
 * specs the shared chat renderer consumes, and that the cash-vs-payers chart
 * actually opens as a dual-axis combo (asserted via the renderer's own
 * preferDualAxis predicate, not assumed).
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  lineArtifact,
  dualMeasureArtifact,
  stackedArtifact,
  heatmapArtifact,
  barArtifact,
} from '../pages/OpsConsole/ops-chart-artifact';
import { preferDualAxis, toDualAxisSpec } from '../pages/Chat/components/chart-section-menu';

const dates = ['2026-06-01', '2026-06-02', '2026-06-03'];

describe('lineArtifact', () => {
  const a = lineArtifact({
    id: 'cash',
    title: 'Cash collected — daily',
    dates,
    valueKey: 'cash_vnd',
    valueLabel: 'Cash collected (₫)',
    values: [1_000_000, 2_000_000, 3_000_000],
  });

  it('builds one row per date with the value keyed by valueKey', () => {
    expect(a.spec.type).toBe('line');
    expect(a.spec.data).toEqual([
      { date: '2026-06-01', cash_vnd: 1_000_000 },
      { date: '2026-06-02', cash_vnd: 2_000_000 },
      { date: '2026-06-03', cash_vnd: 3_000_000 },
    ]);
    expect(a.spec.encoding).toEqual({ category: 'date', value: 'cash_vnd' });
  });

  it('carries time + measure column descriptors with friendly labels', () => {
    expect(a.columns).toEqual([
      { key: 'date', label: 'Date', dataType: 'time', kind: 'timeDimension' },
      { key: 'cash_vnd', label: 'Cash collected (₫)', dataType: 'number', kind: 'measure' },
    ]);
    expect(a.truncated).toBe(false);
    expect(a.originalRowCount).toBe(3);
  });

  it('defaults missing values to 0 (no NaN holes)', () => {
    const short = lineArtifact({
      id: 'x',
      title: 't',
      dates,
      valueKey: 'v',
      valueLabel: 'V',
      values: [5],
    });
    expect(short.spec.data.map((r) => r.v)).toEqual([5, 0, 0]);
  });
});

describe('dualMeasureArtifact (cash vs payers)', () => {
  const a = dualMeasureArtifact({
    id: 'pvc',
    title: 'Paying users vs cash — daily',
    dates,
    leftKey: 'cash_vnd',
    leftLabel: 'Cash collected (₫)',
    leftValues: [1_000_000_000, 2_000_000_000, 3_000_000_000],
    rightKey: 'payers',
    rightLabel: 'Paying users',
    rightValues: [1_200, 1_500, 1_800],
  });

  it('puts both measures in each row with the left metric as the first numeric key', () => {
    expect(Object.keys(a.spec.data[0])).toEqual(['date', 'cash_vnd', 'payers']);
    expect(a.spec.encoding).toEqual({ category: 'date', value: 'cash_vnd' });
    // No `series` in the encoding — required for the dual-axis auto-upgrade.
    expect(a.spec.encoding.series).toBeUndefined();
  });

  it('opens as a dual-axis combo (left bars = cash, right line = payers)', () => {
    // The renderer auto-upgrades single-axis specs whose two measures differ in
    // scale by >4×; cash (≈1e9) vs payers (≈1e3) is far past that.
    expect(preferDualAxis(a.spec)).toBe(true);
    const dual = toDualAxisSpec(a.spec);
    expect(dual.type).toBe('dual-axis');
    expect(dual.encoding.value).toBe('cash_vnd'); // left axis (bars)
    expect(dual.encoding.series).toBe('payers'); // right axis (line)
  });
});

describe('stackedArtifact (gateway mix)', () => {
  const a = stackedArtifact({
    id: 'gw',
    title: 'Gateway mix over time',
    dates: ['2026-06-01', '2026-06-02'],
    categories: ['Apple', 'Google'],
    days: [
      { Apple: 100, Google: 50 },
      { Apple: 200, Google: 75 },
    ],
  });

  it('converts wide per-day records into long category rows', () => {
    expect(a.spec.type).toBe('stacked-bar');
    expect(a.spec.encoding).toEqual({ category: 'date', value: 'cash_vnd', series: 'gateway' });
    expect(a.spec.data).toEqual([
      { date: '2026-06-01', gateway: 'Apple', cash_vnd: 100 },
      { date: '2026-06-01', gateway: 'Google', cash_vnd: 50 },
      { date: '2026-06-02', gateway: 'Apple', cash_vnd: 200 },
      { date: '2026-06-02', gateway: 'Google', cash_vnd: 75 },
    ]);
  });

  it('preserves per-day per-gateway sums (long-format round-trips the wide input)', () => {
    const byDayGw = new Map<string, number>();
    for (const r of a.spec.data) byDayGw.set(`${r.date}|${r.gateway}`, Number(r.cash_vnd));
    expect(byDayGw.get('2026-06-01|Apple')).toBe(100);
    expect(byDayGw.get('2026-06-02|Google')).toBe(75);
  });

  it('fills a gateway absent on a given day with 0', () => {
    const b = stackedArtifact({
      id: 'gw2',
      title: 't',
      dates: ['2026-06-01'],
      categories: ['Apple', 'Google'],
      days: [{ Apple: 100 }], // Google missing this day
    });
    expect(b.spec.data).toContainEqual({ date: '2026-06-01', gateway: 'Google', cash_vnd: 0 });
  });
});

describe('heatmapArtifact (purchase timing)', () => {
  const a = heatmapArtifact({
    id: 'heat',
    title: 'Purchase intensity',
    cells: [
      { hour: 9, dow: 1, cash: 500 },
      { hour: 20, dow: 7, cash: 9000 },
    ],
  });

  it('builds a heatmap spec with hour→category (x) and weekday→series (y)', () => {
    expect(a.spec.type).toBe('heatmap');
    expect(a.spec.encoding).toEqual({ category: 'hour', value: 'cash_vnd', series: 'weekday' });
  });

  it('formats hour as zero-padded "HHh" and ISO dow as weekday abbrev', () => {
    expect(a.spec.data).toEqual([
      { hour: '09h', weekday: 'Mon', cash_vnd: 500 },
      { hour: '20h', weekday: 'Sun', cash_vnd: 9000 },
    ]);
  });

  it('carries dimension + measure columns', () => {
    expect(a.columns).toEqual([
      { key: 'hour', label: 'Hour of day', dataType: 'string', kind: 'dimension' },
      { key: 'weekday', label: 'Day of week', dataType: 'string', kind: 'dimension' },
      { key: 'cash_vnd', label: 'Cash collected (₫)', dataType: 'number', kind: 'measure' },
    ]);
  });
});

describe('barArtifact (payer-tier concentration)', () => {
  const a = barArtifact({
    id: 'conc',
    title: 'Revenue concentration by payer tier',
    categoryKey: 'tier',
    categoryLabel: 'Payer tier',
    valueKey: 'ltv_vnd',
    valueLabel: 'Lifetime value (₫)',
    rows: [
      { category: 'whale', value: 4_600_000_000 },
      { category: 'dolphin', value: 3_300_000_000 },
      { category: 'minnow', value: 2_100_000_000 },
    ],
  });

  it('builds a bar spec, one row per category', () => {
    expect(a.spec.type).toBe('bar');
    expect(a.spec.encoding).toEqual({ category: 'tier', value: 'ltv_vnd' });
    expect(a.spec.data).toEqual([
      { tier: 'whale', ltv_vnd: 4_600_000_000 },
      { tier: 'dolphin', ltv_vnd: 3_300_000_000 },
      { tier: 'minnow', ltv_vnd: 2_100_000_000 },
    ]);
  });
});
