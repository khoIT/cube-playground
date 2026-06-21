/**
 * Monitor control bar — the single top row of the merged Monitor tab:
 *   View grain toggle · Range picker · freshness · Notices · Settings.
 *
 * Window status (freshness / cadence change / clamp / carry-forward / slice
 * scope) lives in the Notices popover — the per-chart meta strip was removed so
 * the same note doesn't repeat under every chart. Settings is its own popover
 * (the "Track every" capture-cadence knob): a write setting kept out of the
 * chart flow so it stops reading as a second view-grain control. Notices and
 * Settings are separate borderless triggers — only one panel opens at a time.
 */

import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import { Bell, Settings } from 'lucide-react';
import type {
  CadenceChange,
  MovementGranularity,
} from '../../../../../api/segment-movement-client';
import type { Segment } from '../../../../../types/segment-api';
import type { GrainAvailability } from '../movement/grain-availability';
import { GranularityToggle } from '../movement/granularity-toggle';
import { TrackCadenceControl } from './track-cadence-control';
import { MonitorRangePicker } from './monitor-range-picker';
import { capForGrain } from './monitor-range';
import type { DateRange } from './monitor-range';
import { SliceScopeNote } from '../../../slice-scope/slice-scope-note';
import { describePredicate } from '../../../slice-scope/describe-predicate';
import { parseCubeSegmentsFromQueryJson } from '../../../slice-scope/parse-cube-segments';
import styles from '../../../segments.module.css';

interface Props {
  grain: MovementGranularity;
  availability: Record<MovementGranularity, GrainAvailability>;
  onGrainChange: (g: MovementGranularity) => void;
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
  /** Lifted from the membership response — drives the freshness/cadence pills. */
  asOf: string | null;
  stale?: boolean;
  cadenceChanges?: CadenceChange[];
  /** Buckets held flat because the view grain is finer than what was captured. */
  carryForward?: string[];
  /** True when the effective window was narrowed to the grain cap. */
  clamped: boolean;
  /** Segment + change handler — passed through to the capture-cadence popover. */
  segment: Segment;
  onSegmentChange?: (next: Segment) => void;
}

type PillTone = 'muted' | 'warning' | 'info' | 'success';

function Pill({ children, tone }: { children: ReactNode; tone: PillTone }): ReactElement {
  return <span className={`${styles.statusPill} ${styles[`statusPill_${tone}`]}`}>{children}</span>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `2026-06-19 09:00` → `Jun 19` for the cadence-change pill. */
function shortDay(ts: string): string {
  const m = parseInt(ts.slice(5, 7), 10);
  const d = parseInt(ts.slice(8, 10), 10);
  return Number.isFinite(m) && m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${d}` : ts.slice(0, 10);
}

export function MonitorControlBar({
  grain, availability, onGrainChange, range, onRangeChange,
  asOf, stale, cadenceChanges, carryForward, clamped, segment, onSegmentChange,
}: Props): ReactElement {
  const changes = cadenceChanges ?? [];
  const carried = carryForward ?? [];
  // Only one panel opens at a time — Notices and Settings are sibling popovers.
  const [openPanel, setOpenPanel] = useState<'notices' | 'settings' | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  // Close whichever popover is open on outside click / Escape.
  useEffect(() => {
    if (!openPanel) return;
    function onDoc(e: MouseEvent): void {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setOpenPanel(null);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpenPanel(null);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [openPanel]);

  // Human-readable cadence-change note (e.g. "capture: 15m → 1h · Jun 19").
  const cadenceNote = changes.length === 1
    ? `capture: ${changes[0].from} → ${changes[0].to} · ${shortDay(changes[0].ts)}`
    : `${changes.length} capture cadence changes`;

  // Slice-scope caveat (formerly a chip under the KPI tiles) now lives in the
  // Notices popover. SliceScopeNote renders null when there's no slice, so we
  // count its chips here to drive both "show it?" and the Notices count.
  const cubeSegments = parseCubeSegmentsFromQueryJson(segment.cube_query_json);
  const sliceActive = (cubeSegments?.length ?? 0) + describePredicate(segment.predicate_tree).length > 0;

  // Window caveats fold into the Notices popover (freshness "as of" stays
  // inline). The count flags how many distinct caveats are worth a read.
  const noticeCount =
    (clamped ? 1 : 0) +
    (changes.length > 0 ? 1 : 0) +
    (carried.length > 0 ? 1 : 0) +
    (stale ? 1 : 0) +
    (sliceActive ? 1 : 0);

  return (
    <div className={styles.monitorControlRow}>
      {/* 1 · View grain — the display controls (downsample + window). */}
      <section className={`${styles.monitorControlCard} ${styles.monitorControlCardView}`}>
        <div className={styles.monitorControlGroup}>
          <span className={styles.monitorControlLabel}>View grain</span>
          <GranularityToggle value={grain} availability={availability} onChange={onGrainChange} />
        </div>
        <div className={styles.monitorControlGroup}>
          <span className={styles.monitorControlLabel}>Range</span>
          <MonitorRangePicker value={range} onChange={onRangeChange} />
        </div>
      </section>

      {/* 2 · Status & controls — borderless: Notices + Settings ride the top
          row, the freshness stamp sits on its own row beneath them. */}
      <div className={styles.monitorStatusRail} ref={railRef}>
        <div className={styles.monitorStatusButtons}>
        {noticeCount > 0 && (
          <div className={styles.monitorPopAnchor}>
            <button
              type="button"
              className={styles.monitorNoticeBtn}
              aria-label={`Notices — ${noticeCount} item${noticeCount > 1 ? 's' : ''}`}
              aria-expanded={openPanel === 'notices'}
              onClick={() => setOpenPanel((v) => (v === 'notices' ? null : 'notices'))}
            >
              <Bell size={13} aria-hidden />
              Notices
              <span className={styles.monitorNoticeCount}>{noticeCount}</span>
            </button>
            {openPanel === 'notices' && (
              <div className={styles.monitorPopover} role="dialog" aria-label="Notices">
                <span className={styles.monitorPopoverLabel}>Notices</span>
                <div className={styles.monitorNotices}>
                  {clamped && <Pill tone="warning">showing last {capForGrain(grain)}d · {grain} cap</Pill>}
                  {changes.length > 0 && <Pill tone="info">{cadenceNote}</Pill>}
                  {carried.length > 0 && <Pill tone="muted">values held flat · view finer than capture</Pill>}
                  {stale && <Pill tone="warning">stale · last good</Pill>}
                  {sliceActive && (
                    <SliceScopeNote predicate={segment.predicate_tree} cubeSegments={cubeSegments} />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className={styles.monitorPopAnchor}>
          <button
            type="button"
            className={styles.monitorGearBtn}
            aria-label="Settings"
            aria-expanded={openPanel === 'settings'}
            title="Capture-cadence settings"
            onClick={() => setOpenPanel((v) => (v === 'settings' ? null : 'settings'))}
          >
            <Settings size={15} aria-hidden />
          </button>
          {openPanel === 'settings' && (
            <div className={styles.monitorPopover} role="dialog" aria-label="Settings">
              <span className={styles.monitorPopoverLabel}>Capture cadence</span>
              <TrackCadenceControl segment={segment} onChange={onSegmentChange} />
            </div>
          )}
        </div>
        </div>

        {asOf && <Pill tone="success">as of {asOf} GMT+7</Pill>}
      </div>
    </div>
  );
}
