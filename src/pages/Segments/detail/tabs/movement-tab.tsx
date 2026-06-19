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

import { ReactElement, useCallback, useMemo, useState } from 'react';
import { Waypoints } from 'lucide-react';
import type { Segment } from '../../../../types/segment-api';
import type { CaptureEra, MovementGranularity } from '../../../../api/segment-movement-client';
import {
  computeGrainAvailability,
  isGrainSelectable,
  finestFullGrain,
} from './movement/grain-availability';
import { GranularityToggle } from './movement/granularity-toggle';
import { CadenceCoverageStrip } from './movement/cadence-coverage-strip';
import { SnapshotCadenceControl } from './movement/snapshot-cadence-control';
import { KpiTrendSection } from './movement/kpi-trend-section';
import { MembershipMovementSection } from './movement/membership-movement-section';
import { StateDistributionTrendSection } from './movement/state-distribution-trend-section';
import styles from '../../segments.module.css';

/** Meta reported up by the membership section from its movement response. */
interface MovementMeta {
  effective: MovementGranularity;
  finest?: MovementGranularity;
  captureEras?: CaptureEra[];
}

interface Props {
  segment: Segment;
  /** Propagates a capture-cadence change up so the header/state stay in sync. */
  onSegmentChange?: (next: Segment) => void;
}

export function MovementTab({ segment, onSegmentChange }: Props): ReactElement {
  const [granularity, setGranularity] = useState<MovementGranularity>('daily');
  // Honest capture timeline, reported up by the membership section. Empty until
  // the first response — availability then treats daily as the universal floor.
  const [captureEras, setCaptureEras] = useState<CaptureEra[]>([]);
  const [finest, setFinest] = useState<MovementGranularity>('15m');

  const availability = useMemo(() => computeGrainAvailability(captureEras), [captureEras]);

  const handleMeta = useCallback((meta: MovementMeta) => {
    setCaptureEras(meta.captureEras ?? []);
    if (meta.finest) setFinest(meta.finest);
    // Re-clamp the active selection against the freshly reported timeline: if the
    // current grain is no longer captured anywhere (window/segment changed), snap
    // to the finest fully-covered grain so the toggle never sits on a disabled
    // option and the sections stop requesting unattainable detail.
    const avail = computeGrainAvailability(meta.captureEras ?? []);
    setGranularity((g) => (isGrainSelectable(avail[g]) ? g : finestFullGrain(avail)));
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
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>View</span>
        <GranularityToggle value={granularity} availability={availability} onChange={setGranularity} />
      </header>

      <CadenceCoverageStrip eras={captureEras} finest={finest} />

      <SnapshotCadenceControl segment={segment} onChange={onSegmentChange} />

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
