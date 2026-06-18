/**
 * Movement tab (BETA) — how a segment drifts over time: KPI trends, membership
 * churn-in/out, and per-user state-distribution shifts, from the lakehouse
 * snapshot read API. Additive to the Monitor tab (does not replace it).
 *
 * A single whole-view granularity toggle downsamples every section; it clamps
 * to the coarsest cadence actually captured in the window (reported up by the
 * membership section) so we never offer finer detail than was snapshotted.
 * Chart line↔bar/table/CSV is the AssistantChartSection view menu per chart.
 */

import { ReactElement, useCallback, useState } from 'react';
import { Waypoints } from 'lucide-react';
import type { Segment } from '../../../../types/segment-api';
import {
  isGranularitySelectable,
  type MovementGranularity,
} from '../../../../api/segment-movement-client';
import { GranularityToggle } from './movement/granularity-toggle';
import { KpiTrendSection } from './movement/kpi-trend-section';
import { MembershipMovementSection } from './movement/membership-movement-section';
import { StateDistributionTrendSection } from './movement/state-distribution-trend-section';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
}

export function MovementTab({ segment }: Props): ReactElement {
  const [granularity, setGranularity] = useState<MovementGranularity>('daily');
  // Finest grain captured in the window; until the first response says
  // otherwise, allow all options (the membership section reports the real value).
  const [effective, setEffective] = useState<MovementGranularity>('15m');

  const handleMeta = useCallback((meta: { effective: MovementGranularity }) => {
    setEffective(meta.effective);
    // Re-clamp the active selection: if the user picked a grain finer than what
    // was actually captured (possible before the first response sets effective),
    // snap down so the toggle never shows a disabled-but-active option and the
    // sections stop requesting unattainable detail.
    setGranularity((g) => (isGranularitySelectable(g, meta.effective) ? g : meta.effective));
  }, []);

  // Snapshots exist only for predicate segments bound to a game.
  if (segment.type !== 'predicate' || !segment.game_id) {
    return (
      <div className={styles.monitorGrid}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 16 }}>
          Movement tracking is available for predicate segments bound to a game.
        </div>
      </div>
    );
  }

  // Sub-daily windows are bounded tighter (server caps too); daily reaches back further.
  const days = granularity === 'daily' ? 30 : 14;

  return (
    <div className={styles.monitorGrid}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          paddingBottom: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-muted)',
              color: 'var(--text-secondary)',
            }}
          >
            <Waypoints size={14} />
          </span>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Movement</h2>
          <span
            style={{
              background: 'var(--info-soft)',
              color: 'var(--info-ink)',
              borderRadius: 'var(--radius-full)',
              padding: '2px 8px',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}
          >
            BETA
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <GranularityToggle value={granularity} effective={effective} onChange={setGranularity} />
      </header>

      <KpiTrendSection segmentId={segment.id} granularity={granularity} days={days} />
      <MembershipMovementSection
        segmentId={segment.id}
        granularity={granularity}
        days={days}
        onMeta={handleMeta}
      />
      <StateDistributionTrendSection segmentId={segment.id} granularity={granularity} days={days} />
    </div>
  );
}
