/**
 * Unit tests for the snapshot-ledger + fleet-coverage building blocks.
 *
 * Both surfaces derive their grain chips from the SAME capture eras the
 * coverage strip paints (computeCaptureEras → dayGrainMap / eraGrains), so the
 * ledger, the strip, and the fleet row can never disagree. These tests pin that
 * parity and the coarse→fine grain ordering, plus the in-memory fleet grouping.
 */

import { describe, it, expect } from 'vitest';
import {
  computeCaptureEras,
  dayGrainMap,
  perSnapshotGrainMap,
  eraGrains,
  finestEraCadence,
} from '../src/lakehouse/downsample-snapshots.js';

// A mixed timeline: 2 daily-only days, then a day captured every 15 minutes.
const MIXED_TS = [
  '2026-06-01 00:00:00',
  '2026-06-02 00:00:00',
  '2026-06-03 00:00:00',
  '2026-06-03 00:15:00',
  '2026-06-03 00:30:00',
  '2026-06-03 00:45:00',
];

describe('dayGrainMap — ledger/strip grain parity', () => {
  it('maps each captured day to its era cadence', () => {
    const eras = computeCaptureEras(MIXED_TS);
    const grainByDay = dayGrainMap(eras);
    expect(grainByDay.get('2026-06-01')).toBe('daily');
    expect(grainByDay.get('2026-06-02')).toBe('daily');
    expect(grainByDay.get('2026-06-03')).toBe('15m');
  });

  it('every ledger row grain equals the strip era covering its day', () => {
    const eras = computeCaptureEras(MIXED_TS);
    const grainByDay = dayGrainMap(eras);
    // For each ts, the grain the ledger would render must match the era whose
    // [from,to] day-range contains that ts.
    for (const ts of MIXED_TS) {
      const day = ts.slice(0, 10);
      const era = eras.find((e) => e.from.slice(0, 10) <= day && day <= e.to.slice(0, 10));
      expect(grainByDay.get(day)).toBe(era?.cadence);
    }
  });

  it('returns an empty map for no eras', () => {
    expect(dayGrainMap([]).size).toBe(0);
  });
});

describe('perSnapshotGrainMap — per-row grain on within-day cadence change', () => {
  // The screenshot case: morning captured every 15m, then switched to 1h in the
  // afternoon. dayGrainMap collapses the whole day to 15m (its finest gap); the
  // per-snapshot map must label the afternoon 1h rows as 1h.
  const SWITCH_TS = [
    '2026-06-18 00:00:00', // prior daily anchor
    '2026-06-19 09:00:00',
    '2026-06-19 09:15:00',
    '2026-06-19 09:30:00',
    '2026-06-19 12:00:00',
    '2026-06-19 13:00:00',
    '2026-06-19 14:00:00',
  ];

  it('labels the 15m morning rows 15m and the 1h afternoon rows 1h', () => {
    const grain = perSnapshotGrainMap(SWITCH_TS);
    expect(grain.get('2026-06-19 09:00:00')).toBe('15m');
    expect(grain.get('2026-06-19 09:15:00')).toBe('15m');
    expect(grain.get('2026-06-19 09:30:00')).toBe('15m');
    expect(grain.get('2026-06-19 12:00:00')).toBe('1h');
    expect(grain.get('2026-06-19 13:00:00')).toBe('1h');
    expect(grain.get('2026-06-19 14:00:00')).toBe('1h');
  });

  it('labels a lone daily anchor (no near neighbour) daily', () => {
    expect(perSnapshotGrainMap(SWITCH_TS).get('2026-06-18 00:00:00')).toBe('daily');
  });

  it('rounds an irregular gap UP to the coarser grain (40m → 1h)', () => {
    const grain = perSnapshotGrainMap(['2026-06-19 09:00:00', '2026-06-19 09:40:00']);
    expect(grain.get('2026-06-19 09:00:00')).toBe('1h');
    expect(grain.get('2026-06-19 09:40:00')).toBe('1h');
  });

  it('a single snapshot is daily; an empty list yields an empty map', () => {
    expect(perSnapshotGrainMap(['2026-06-19 09:15:00']).get('2026-06-19 09:15:00')).toBe('daily');
    expect(perSnapshotGrainMap([]).size).toBe(0);
  });
});

describe('eraGrains — distinct grains, coarse → fine', () => {
  it('orders daily first then finer grains', () => {
    const eras = computeCaptureEras(MIXED_TS);
    expect(eraGrains(eras)).toEqual(['daily', '15m']);
  });

  it('dedupes repeated cadences across eras', () => {
    // daily, then 15m, then daily again → distinct {daily,15m}, coarse-first.
    const ts = [
      '2026-06-01 00:00:00',
      '2026-06-02 00:00:00', '2026-06-02 00:15:00',
      '2026-06-03 00:00:00',
    ];
    expect(eraGrains(computeCaptureEras(ts))).toEqual(['daily', '15m']);
  });

  it('returns [] when there are no eras', () => {
    expect(eraGrains([])).toEqual([]);
  });
});

describe('finestEraCadence over a mixed window', () => {
  it('is the finest grain captured anywhere', () => {
    expect(finestEraCadence(computeCaptureEras(MIXED_TS))).toBe('15m');
  });
});

// ─── Fleet in-memory assembly (mirrors the route's grouping) ──────────────────

describe('fleet coverage row assembly', () => {
  // Mirror the route: distinct (segment_id, ts) rows → group → eras/grains/depth.
  type TsRow = { segmentId: string; ts: string };
  const tsRows: TsRow[] = [
    { segmentId: 'whales', ts: '2026-06-01 00:00:00' },
    { segmentId: 'whales', ts: '2026-06-02 00:00:00' },
    { segmentId: 'whales', ts: '2026-06-02 00:15:00' },
    { segmentId: 'daily-seg', ts: '2026-05-20 00:00:00' },
    { segmentId: 'daily-seg', ts: '2026-05-21 00:00:00' },
  ];

  function assemble(segId: string) {
    const ts = tsRows.filter((r) => r.segmentId === segId).map((r) => r.ts).sort();
    const eras = computeCaptureEras(ts);
    const dayCount = ts.length
      ? Math.round((Date.parse(ts[ts.length - 1].slice(0, 10) + 'T00:00:00Z') -
          Date.parse(ts[0].slice(0, 10) + 'T00:00:00Z')) / 86_400_000) + 1
      : 0;
    return { grains: eraGrains(eras), depthDays: dayCount, last: ts[ts.length - 1] ?? null };
  }

  it('whales: sub-daily on day 2 → grains [daily,15m], depth 2d', () => {
    const w = assemble('whales');
    expect(w.grains).toEqual(['daily', '15m']);
    expect(w.depthDays).toBe(2);
    expect(w.last).toBe('2026-06-02 00:15:00');
  });

  it('daily-seg: daily only → grains [daily], depth 2d', () => {
    const d = assemble('daily-seg');
    expect(d.grains).toEqual(['daily']);
    expect(d.depthDays).toBe(2);
  });

  it('a segment with no rows → no grains, depth 0', () => {
    const none = assemble('missing');
    expect(none.grains).toEqual([]);
    expect(none.depthDays).toBe(0);
    expect(none.last).toBeNull();
  });
});
