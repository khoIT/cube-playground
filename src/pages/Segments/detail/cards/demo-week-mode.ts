/**
 * TEMPORARY demo mode for the lakehouse monitor cards: append `&demo=1` to the
 * segment detail URL to feed the trajectory + metric-movement cards a week of
 * fixture data (demo-week-fixture.json) shaped exactly like the real API
 * payloads, so the after-a-week look can be previewed before nightly history
 * accrues. The fixture trajectory deliberately skips 2026-06-09 to demo gap
 * rendering. Delete alongside the fixture once real history exists.
 */

import fixture from './demo-week-fixture.json';

export function isDemoWeekMode(): boolean {
  // HashRouter keeps the query inside the hash: /#/segments/:id?tab=monitor&demo=1
  return /[?&]demo=1/.test(window.location.hash) || /[?&]demo=1/.test(window.location.search);
}

interface DemoSeriesPoint {
  date: string;
  value: number;
  memberCount: number;
}

export function demoTrajectoryPayload(segmentId: string, gameId: string) {
  return { segmentId, gameId, ...fixture.trajectory };
}

export function demoEligibleMetrics(): Array<{ metricKey: string; label: string; unit: string }> {
  return fixture.metrics;
}

export function demoMetricSeriesPayload(
  segmentId: string,
  gameId: string,
  metric: string,
  lens: 'current' | 'entry' | 'stayers',
  anchor: string | null,
) {
  const byLens = (fixture.series as Record<string, Record<string, DemoSeriesPoint[]>>)[metric];
  const meta = fixture.metrics.find((m) => m.metricKey === metric) ?? fixture.metrics[0];
  return {
    segmentId,
    gameId,
    metric,
    label: meta.label,
    unit: meta.unit,
    lens,
    anchor: lens === 'current' ? null : anchor,
    days: 90,
    points: byLens?.[lens] ?? [],
    joinWarning: null,
    survivorBiased: lens === 'stayers',
  };
}
