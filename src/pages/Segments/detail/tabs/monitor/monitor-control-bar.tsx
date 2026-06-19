/**
 * Monitor control bar — the single top row of the merged Monitor tab:
 *   View grain toggle · Range picker · status pills · capture-cadence gear.
 *
 * The pills are the ONLY place window status reads (freshness / cadence change /
 * clamp / carry-forward) — the per-chart meta strip was removed so the same note
 * doesn't repeat under every chart. The gear opens the capture-cadence popover
 * (the "Track every" knob): it's a write setting, kept out of the chart flow so
 * it stops reading as a second view-grain control.
 */

import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
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
  const [gearOpen, setGearOpen] = useState(false);
  const gearRef = useRef<HTMLDivElement>(null);

  // Close the capture-cadence popover on outside click / Escape.
  useEffect(() => {
    if (!gearOpen) return;
    function onDoc(e: MouseEvent): void {
      if (gearRef.current && !gearRef.current.contains(e.target as Node)) setGearOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setGearOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [gearOpen]);

  // Human-readable cadence-change note (e.g. "capture: 15m → 1h · Jun 19").
  const cadenceNote = changes.length === 1
    ? `capture: ${changes[0].from} → ${changes[0].to} · ${shortDay(changes[0].ts)}`
    : `${changes.length} capture cadence changes`;

  return (
    <div className={styles.monitorControlBar}>
      <div className={styles.monitorControlGroup}>
        <span className={styles.monitorControlLabel}>View grain</span>
        <GranularityToggle value={grain} availability={availability} onChange={onGrainChange} />
      </div>

      <div className={styles.monitorControlGroup}>
        <span className={styles.monitorControlLabel}>Range</span>
        <MonitorRangePicker value={range} onChange={onRangeChange} />
      </div>

      <div className={styles.monitorControlStatus}>
        {clamped && <Pill tone="warning">showing last {capForGrain(grain)}d · {grain} cap</Pill>}
        {changes.length > 0 && <Pill tone="info">{cadenceNote}</Pill>}
        {carried.length > 0 && <Pill tone="muted">values held flat · view finer than capture</Pill>}
        {stale && <Pill tone="warning">stale · last good</Pill>}
        {asOf && <Pill tone="success">as of {asOf} GMT+7</Pill>}

        <div className={styles.monitorGear} ref={gearRef}>
          <button
            type="button"
            className={styles.monitorGearBtn}
            aria-label="Capture settings"
            aria-expanded={gearOpen}
            title="Capture cadence"
            onClick={() => setGearOpen((v) => !v)}
          >
            <Settings size={15} aria-hidden />
          </button>
          {gearOpen && (
            <div className={styles.monitorGearPopover} role="dialog" aria-label="Capture cadence">
              <TrackCadenceControl segment={segment} onChange={onSegmentChange} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
