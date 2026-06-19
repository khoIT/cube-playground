/**
 * Monitor tab — the single "Now → Over time" surface and default landing for
 * ALL segments. Folds in what was the separate Movement (beta) tab:
 *
 *   NOW       — slice scope, the unified Track-cadence knob, current size visual
 *   (strip)   — cadence coverage spine (which grain was captured, when)
 *   OVER TIME — KPI trends, membership churn, state-distribution shifts
 *
 * For predicate segments bound to a game (snapshot-eligible) the OVER TIME zone
 * reads the lakehouse snapshot history and a single view-grain toggle downsamples
 * every section. Snapshot-less segments degrade to the SQLite size/metric trends
 * (no strip, no view grain). Refresh history shows for both. The view-grain toggle
 * is display-only — distinct from the Track knob, which sets the capture cadence.
 */

import { ReactElement, useCallback, useMemo, useState } from 'react';
import type { Segment } from '../../../../types/segment-api';
import type { CaptureEra, MovementGranularity } from '../../../../api/segment-movement-client';
import { computeGrainAvailability, isGrainSelectable, finestFullGrain } from './movement/grain-availability';
import { GranularityToggle } from './movement/granularity-toggle';
import { CadenceCoverageStrip } from './movement/cadence-coverage-strip';
import { KpiTrendSection } from './movement/kpi-trend-section';
import { MembershipMovementSection } from './movement/membership-movement-section';
import { StateDistributionTrendSection } from './movement/state-distribution-trend-section';
import { SizeTrendSection } from './monitor/size-trend-section';
import { TrajectoryCard } from '../cards/trajectory-card';
import { RefreshHistorySection } from './monitor/refresh-history-section';
import { TrackCadenceControl } from './monitor/track-cadence-control';
import { SliceScopeNote } from '../../slice-scope/slice-scope-note';
import { parseCubeSegmentsFromQueryJson } from '../../slice-scope/parse-cube-segments';
import styles from '../../segments.module.css';

/** Meta the membership section reports up from its movement response. */
interface MovementMeta {
  effective: MovementGranularity;
  finest?: MovementGranularity;
  captureEras?: CaptureEra[];
}

interface Props {
  segment: Segment;
  /** Propagates a segment change (track cadence) up so the header pill + state stay in sync. */
  onSegmentChange?: (next: Segment) => void;
}

export function MonitorTab({ segment, onSegmentChange }: Props): ReactElement {
  // View-grain state for the OVER TIME zone (lifted from the old Movement tab).
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
    // current grain is no longer captured anywhere, snap to the finest fully-covered
    // grain so the toggle never sits on a disabled option.
    const avail = computeGrainAvailability(meta.captureEras ?? []);
    setGranularity((g) => (isGrainSelectable(avail[g]) ? g : finestFullGrain(avail)));
  }, []);

  // Snapshots (the lakehouse history) exist only for predicate segments bound to
  // a game. Everything else degrades to the SQLite trends + refresh history.
  const hasSnapshots = segment.type === 'predicate' && Boolean(segment.game_id);

  // Sub-daily windows are bounded tighter (server caps too); daily reaches further.
  const days = granularity === 'daily' ? 30 : 14;

  return (
    <div className={styles.monitorGrid}>
      {hasSnapshots && (
        <header className={styles.monitorTabHeader}>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>View grain</span>
          <GranularityToggle value={granularity} availability={availability} onChange={setGranularity} />
        </header>
      )}

      {/* ── NOW ─────────────────────────────────────────────────────────── */}
      <div className={styles.zoneEyebrow}>Now</div>
      <SliceScopeNote
        predicate={segment.predicate_tree}
        cubeSegments={parseCubeSegmentsFromQueryJson(segment.cube_query_json)}
      />
      <TrackCadenceControl segment={segment} onChange={onSegmentChange} />
      {hasSnapshots ? (
        // Lakehouse size trajectory is the current-size visual for snapshot segments.
        <TrajectoryCard segment={segment} />
      ) : (
        // SQLite size-over-time is the fallback when there is no snapshot history.
        <SizeTrendSection segment={segment} />
      )}

      {/* ── OVER TIME ───────────────────────────────────────────────────── */}
      {hasSnapshots ? (
        <>
          <CadenceCoverageStrip eras={captureEras} finest={finest} />
          <div className={styles.zoneEyebrow}>Over time</div>
          <KpiTrendSection segmentId={segment.id} granularity={granularity} days={days} />
          <MembershipMovementSection
            segmentId={segment.id}
            granularity={granularity}
            days={days}
            onMeta={handleMeta}
          />
          <StateDistributionTrendSection segmentId={segment.id} granularity={granularity} days={days} />
        </>
      ) : (
        <>
          <div className={styles.zoneEyebrow}>Over time</div>
          <div className={styles.monitorSection}>
            <div className={styles.emptyState}>
              <p className={styles.emptyStateText} style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                No snapshots for this segment
              </p>
              <p className={styles.emptyStateText} style={{ maxWidth: '56ch' }}>
                Snapshot trends — KPI history, membership movement, and state distribution — are
                only captured for predicate segments bound to a game. This segment has no lakehouse
                history to chart over time; its size and refresh activity are below.
              </p>
            </div>
          </div>
        </>
      )}

      <RefreshHistorySection segment={segment} />
    </div>
  );
}
