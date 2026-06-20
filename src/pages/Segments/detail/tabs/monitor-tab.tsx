/**
 * Monitor tab — the single "Now → Over time" surface and default landing for
 * ALL segments. Folds in what was the separate Movement (beta) tab.
 *
 * For predicate segments bound to a game (snapshot-eligible) the tab leads with
 * a compact control bar (view grain · range picker · freshness/cadence pills),
 * the capture-coverage strip, and a KPI movement-tile row — the at-a-glance
 * "now" block — then flows into the over-time charts (trajectory, KPI trends,
 * membership churn, state-distribution shifts) and the snapshot ledger. The
 * range picker drives every snapshot section; the view grain downsamples them.
 * Snapshot-less segments degrade to the SQLite size/metric trends + refresh log.
 */

import { ReactElement, useCallback, useMemo, useState } from 'react';
import type { Segment } from '../../../../types/segment-api';
import type { Preset } from '../../presets/types';
import type { CadenceChange, CaptureEra, MovementGranularity } from '../../../../api/segment-movement-client';
import { computeGrainAvailability, isGrainSelectable, finestFullGrain } from './movement/grain-availability';
import { CadenceCoverageStrip } from './movement/cadence-coverage-strip';
import { KpiTrendSection } from './movement/kpi-trend-section';
import { MembershipMovementSection } from './movement/membership-movement-section';
import { StateDistributionTrendSection } from './movement/state-distribution-trend-section';
import { SizeTrendSection } from './monitor/size-trend-section';
import { TrajectoryCard } from '../cards/trajectory-card';
import { RefreshHistorySection } from './monitor/refresh-history-section';
import { SnapshotLedgerSection } from './monitor/snapshot-ledger-section';
import { TrackCadenceControl } from './monitor/track-cadence-control';
import { MonitorControlBar } from './monitor/monitor-control-bar';
import { MonitorKpiTiles } from './monitor/monitor-kpi-tiles';
import { clampRangeToGrain, defaultRange, dayCountInclusive, type DateRange } from './monitor/monitor-range';
import { SliceScopeNote } from '../../slice-scope/slice-scope-note';
import { parseCubeSegmentsFromQueryJson } from '../../slice-scope/parse-cube-segments';
import styles from '../../segments.module.css';

/** Meta the membership section reports up: capture timeline + freshness/cadence. */
interface MovementMeta {
  effective: MovementGranularity;
  finest?: MovementGranularity;
  captureEras?: CaptureEra[];
  asOf?: string | null;
  cadenceChanges?: CadenceChange[];
  stale?: boolean;
  carryForward?: string[];
}

interface Props {
  segment: Segment;
  /** Resolved preset — supplies the headline KPI labels/formats for the tiles. */
  preset?: Preset | null;
  /** Propagates a segment change (track cadence) up so the header pill stays in sync. */
  onSegmentChange?: (next: Segment) => void;
}

export function MonitorTab({ segment, preset = null, onSegmentChange }: Props): ReactElement {
  // View-grain (display downsample) — distinct from the Track knob (capture cadence).
  const [granularity, setGranularity] = useState<MovementGranularity>('daily');
  // Honest capture timeline + freshness, reported up by the membership section.
  const [captureEras, setCaptureEras] = useState<CaptureEra[]>([]);
  const [finest, setFinest] = useState<MovementGranularity>('15m');
  const [asOf, setAsOf] = useState<string | null>(null);
  const [cadenceChanges, setCadenceChanges] = useState<CadenceChange[]>([]);
  const [stale, setStale] = useState(false);
  const [carryForward, setCarryForward] = useState<string[]>([]);
  // Desired analysis window; the effective window clamps it to the grain's cap.
  const [range, setRange] = useState<DateRange>(() => defaultRange());

  const availability = useMemo(() => computeGrainAvailability(captureEras), [captureEras]);

  const { range: effRange, clamped } = useMemo(
    () => clampRangeToGrain(range, granularity),
    [range, granularity],
  );
  const effDays = dayCountInclusive(effRange.from, effRange.to);

  const handleMeta = useCallback((meta: MovementMeta) => {
    setCaptureEras(meta.captureEras ?? []);
    if (meta.finest) setFinest(meta.finest);
    setAsOf(meta.asOf ?? null);
    setCadenceChanges(meta.cadenceChanges ?? []);
    setStale(Boolean(meta.stale));
    setCarryForward(meta.carryForward ?? []);
    // Re-clamp the active grain against the freshly reported timeline.
    const avail = computeGrainAvailability(meta.captureEras ?? []);
    setGranularity((g) => (isGrainSelectable(avail[g]) ? g : finestFullGrain(avail)));
  }, []);

  // Snapshots (the lakehouse history) exist only for predicate segments bound to
  // a game. Everything else degrades to the SQLite trends + refresh history.
  const hasSnapshots = segment.type === 'predicate' && Boolean(segment.game_id);

  // Full banner on the degrade path (no controls there to anchor it); compact ⓘ
  // chip on the snapshot path, sitting beside the KPI tiles it qualifies.
  const scopeNoteFull = (
    <SliceScopeNote
      predicate={segment.predicate_tree}
      cubeSegments={parseCubeSegmentsFromQueryJson(segment.cube_query_json)}
    />
  );
  const scopeChip = (
    <SliceScopeNote
      predicate={segment.predicate_tree}
      cubeSegments={parseCubeSegmentsFromQueryJson(segment.cube_query_json)}
      compact
    />
  );

  if (!hasSnapshots) {
    return (
      <div className={styles.monitorGrid}>
        {scopeNoteFull}
        <TrackCadenceControl segment={segment} onChange={onSegmentChange} />
        <SizeTrendSection segment={segment} />
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
        <RefreshHistorySection segment={segment} />
      </div>
    );
  }

  return (
    <div className={styles.monitorGrid}>
      {/* ── At a glance: controls · coverage · KPI movement ─────────────── */}
      <MonitorControlBar
        grain={granularity}
        availability={availability}
        onGrainChange={setGranularity}
        range={range}
        onRangeChange={setRange}
        asOf={asOf}
        stale={stale}
        cadenceChanges={cadenceChanges}
        carryForward={carryForward}
        clamped={clamped}
        segment={segment}
        onSegmentChange={onSegmentChange}
      />
      <CadenceCoverageStrip eras={captureEras} finest={finest} />
      <MonitorKpiTiles segment={segment} preset={preset} range={effRange} granularity={granularity} />
      <div className={styles.monitorScopeChipRow}>{scopeChip}</div>
      <TrajectoryCard
        segment={segment}
        days={effDays}
        granularity={granularity}
        from={effRange.from}
        to={effRange.to}
      />

      {/* ── Over time ───────────────────────────────────────────────────── */}
      <div className={styles.zoneEyebrow}>Over time</div>
      <KpiTrendSection
        segmentId={segment.id}
        granularity={granularity}
        days={effDays}
        from={effRange.from}
        to={effRange.to}
      />
      <div className={styles.monitorChartPair}>
        <MembershipMovementSection
          segmentId={segment.id}
          granularity={granularity}
          days={effDays}
          from={effRange.from}
          to={effRange.to}
          onMeta={handleMeta}
        />
        <StateDistributionTrendSection
          segmentId={segment.id}
          granularity={granularity}
          days={effDays}
          from={effRange.from}
          to={effRange.to}
        />
      </div>
      <SnapshotLedgerSection segmentId={segment.id} from={effRange.from} to={effRange.to} />
      <RefreshHistorySection segment={segment} />
    </div>
  );
}
