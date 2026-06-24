/**
 * Mock event generator for the Event timeline.
 *
 * The annotation infrastructure (calendar table + CRUD + overlay) is real, but
 * there is no event FEED yet and no event-impact analytics. To communicate the
 * intended experience — flags overlaid on the trend + an impact panel — we map a
 * fixed set of illustrative events onto the REAL visible date range, and attach
 * mock impact stats. Everything here is clearly labelled "Mocked" in the UI so it
 * is never mistaken for measured data.
 *
 * Mock annotations carry NEGATIVE ids so they never collide with real rows and
 * are trivially filtered out of any write path.
 */
import type { ChartAnnotation, AnnotationType } from '../../../../api/chart-annotations';

export interface MockTimelineEvent {
  annotation: ChartAnnotation;
  /** Illustrative impact rows shown in the (mocked) detail panel. */
  stats: Array<[string, string]>;
}

/** Add `days` to a YYYY-MM-DD date string (UTC), returning YYYY-MM-DD. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface MockSpec {
  type: AnnotationType;
  title: string;
  /** Position within the window as a fraction [0..1]. */
  at: number;
  /** Duration in days for a ranged event; omit for a point event. */
  spanDays?: number;
  stats: Array<[string, string]>;
}

// Echoes the original design's event set so the surface reads as intended.
const MOCK_SPECS: MockSpec[] = [
  {
    type: 'patch',
    title: 'Patch — weapon rebalance',
    at: 0.18,
    stats: [['DAU next 3d', '+2.1%'], ['Crash rate', '−0.4pp'], ['Sessions / user', '+0.3']],
  },
  {
    type: 'campaign',
    title: 'Store feature ended',
    at: 0.4,
    stats: [['New installs', '−41%'], ['New DAU', '−18.9k'], ['Linked driver', 'Acquisition dip']],
  },
  {
    type: 'event',
    title: 'Double-XP Weekend',
    at: 0.55,
    spanDays: 2,
    stats: [['DAU in window', '+18.2%'], ['Avg session', '+11 min'], ['Spend lift', '+6.4%']],
  },
  {
    type: 'incident',
    title: 'Login server incident',
    at: 0.72,
    stats: [['Duration', '2h 40m'], ['DAU dip', '−9.1%'], ['Recovered', 'next day']],
  },
  {
    type: 'campaign',
    title: 'Season Pass launch',
    at: 0.86,
    stats: [['Payer rate', '+3.8pp'], ['Revenue / day', '+6.0%'], ['DAU', '+4.0%']],
  },
];

/**
 * Build mock events anchored to a real date window [from, to] (inclusive,
 * YYYY-MM-DD). Returns annotations spaced across the window with mock stats.
 */
export function buildMockEvents(from: string, to: string, game: string): MockTimelineEvent[] {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const totalDays = Math.round((end - start) / 86_400_000);

  return MOCK_SPECS.map((spec, i) => {
    const dayOffset = Math.min(totalDays, Math.max(0, Math.round(spec.at * totalDays)));
    const starts_at = addDays(from, dayOffset);
    const ends_at = spec.spanDays ? addDays(starts_at, spec.spanDays) : null;
    return {
      annotation: {
        id: -(i + 1),
        game,
        type: spec.type,
        title: spec.title,
        starts_at,
        ends_at,
        url: null,
        created_by: 'mock',
        created_at: 0,
      },
      stats: spec.stats,
    };
  });
}

/** Mock annotations use negative ids — true for any mock event. */
export function isMockEvent(annotation: ChartAnnotation): boolean {
  return annotation.id < 0;
}
