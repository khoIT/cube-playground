/**
 * Single source of truth for a segment's health presentation, shared by the
 * library list (HealthCell, 2-line stack) and the detail header (one pill).
 *
 * Two orthogonal facts get folded into one coherent vocabulary:
 *   - refresh MODE: predicate segments are "Live" (auto re-evaluated on a
 *     cadence); manual segments are "Static" (a one-off uploaded list).
 *   - lifecycle HEALTH: fresh / refreshing / stale / broken.
 *
 * Freshness only means something for a Live segment — a Static upload is never
 * "fresh". So the green dot (tone=success) IS "fresh"; we never print the word
 * "fresh" next to a "Live" badge, and a manual segment always reads "Static".
 */

import type { Segment } from '../../../types/segment-api';

export type HealthTone = 'success' | 'warning' | 'destructive' | 'info' | 'muted';

type Translate = (key: string, opts?: Record<string, unknown>) => string;

export interface SegmentHealth {
  tone: HealthTone;
  /** Lifecycle word for the list HEALTH column: Fresh / Stale / Refreshing / Broken / Static. */
  label: string;
  /** Secondary list line: "Live · 60m cadence" | "Manual upload" | broken reason | … */
  sub: string;
  /** Compact single-pill text for the detail header: "Live · 60m" | "Stale · 60m" | "Broken" | "Static" | … */
  pill: string;
  /** Plain-English tooltip explaining the state and what the cadence means. */
  tooltip: string;
  /** Auto-refreshing AND healthy → render a pulsing dot. */
  live: boolean;
}

export function resolveSegmentHealth(segment: Segment, t: Translate): SegmentHealth {
  // Static / manual upload — freshness does not apply.
  if (segment.type === 'manual') {
    return {
      tone: 'muted',
      label: t('segments.library.health.static.label', { defaultValue: 'Static' }),
      sub: t('segments.library.health.static.sub', { defaultValue: 'Manual upload' }),
      pill: t('segments.library.health.static.label', { defaultValue: 'Static' }),
      tooltip: t('segments.library.health.tooltip.static', {
        defaultValue: 'Static list from a manual upload — it does not auto-refresh.',
      }),
      live: false,
    };
  }

  const cadence = segment.refresh_cadence_min ?? null;
  const liveText = cadence != null
    ? t('segments.library.health.live.pill', { defaultValue: 'Live · {{cadence}}m', cadence })
    : t('segments.library.health.live.onDemandPill', { defaultValue: 'Live · on demand' });
  const cadenceTip = cadence != null
    ? t('segments.library.health.tooltip.cadence', {
        defaultValue: 'Auto-refreshes every {{cadence}} minutes.',
        cadence,
      })
    : t('segments.library.health.tooltip.onDemand', {
        defaultValue: 'Refreshes only when you run “Refresh now”.',
      });

  if (segment.status === 'broken') {
    const reason = segment.broken_reason
      || t('segments.library.health.broken.sub', { defaultValue: 'Refresh failed' });
    return {
      tone: 'destructive',
      label: t('segments.library.health.broken.label', { defaultValue: 'Broken' }),
      sub: reason,
      pill: t('segments.library.health.broken.label', { defaultValue: 'Broken' }),
      tooltip: reason,
      live: false,
    };
  }

  if (segment.status === 'refreshing') {
    return {
      tone: 'info',
      label: t('segments.library.health.refreshing.label', { defaultValue: 'Refreshing' }),
      sub: liveText,
      pill: t('segments.library.health.refreshing.label', { defaultValue: 'Refreshing…' }),
      tooltip: t('segments.library.health.tooltip.refreshing', {
        defaultValue: 'Re-evaluating members now. {{cadence}}',
        cadence: cadenceTip,
      }),
      live: false,
    };
  }

  if (segment.status === 'stale') {
    return {
      tone: 'warning',
      label: t('segments.library.health.stale.label', { defaultValue: 'Stale' }),
      sub: cadence != null
        ? t('segments.library.health.stale.sub', { defaultValue: 'Live · {{cadence}}m · refresh overdue', cadence })
        : t('segments.library.health.stale.subNoCadence', { defaultValue: 'Refresh overdue' }),
      pill: cadence != null
        ? t('segments.library.health.stale.pill', { defaultValue: 'Stale · {{cadence}}m', cadence })
        : t('segments.library.health.stale.label', { defaultValue: 'Stale' }),
      tooltip: t('segments.library.health.tooltip.stale', {
        defaultValue: 'Last refresh is overdue. {{cadence}}',
        cadence: cadenceTip,
      }),
      live: false,
    };
  }

  // fresh predicate — green dot conveys "fresh"; the visible text is Live + cadence.
  return {
    tone: 'success',
    label: t('segments.library.health.fresh.label', { defaultValue: 'Fresh' }),
    sub: cadence != null
      ? t('segments.library.health.live.cadence', { defaultValue: 'Live · {{cadence}}m cadence', cadence })
      : t('segments.library.health.live.noCadence', { defaultValue: 'Live · on demand' }),
    pill: liveText,
    tooltip: cadenceTip,
    live: true,
  };
}
