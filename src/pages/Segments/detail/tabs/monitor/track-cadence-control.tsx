/**
 * Unified "Track every" cadence control — the SINGLE operator knob that replaces
 * the old two-knob split (Monitor's "Auto-refresh" + Movement's "Snapshot
 * capture"). Picking a value PATCHes `track_cadence`; the server derives and
 * dual-writes the two legacy columns from it, so the live-recompute cron and the
 * lakehouse-capture job both follow one value. `Off` = on-demand only (no
 * background recompute).
 *
 * This governs WHEN the backend recomputes/captures — distinct from the header's
 * view-grain toggle, which only downsamples already-captured points at read time.
 * Owner/admin-only server-side, so non-administrators see it disabled.
 */

import { ReactElement, useState } from 'react';
import { message } from 'antd';
import type { Segment, TrackCadence } from '../../../../../types/segment-api';
import { segmentsClient } from '../../../../../api/segments-client';
import { SegmentApiError } from '../../../../../api/api-client';
import styles from '../../../segments.module.css';

const TRACK_OPTIONS: TrackCadence[] = ['Off', '15m', '30m', '1h', '3h', '6h', '12h', 'daily'];

const LABELS: Record<TrackCadence, string> = {
  Off: 'Off',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '3h': '3h',
  '6h': '6h',
  '12h': '12h',
  daily: 'Daily',
};

/** Cadences whose bucket is < 1h — these multiply heavy snapshot writes. */
const SUB_HOURLY = new Set<TrackCadence>(['15m', '30m']);
/** Above this cohort size, a sub-hourly cadence is worth an explicit cost note. */
const LARGE_SEGMENT = 100_000;

interface Props {
  segment: Segment;
  /** Hands back the updated segment so the tab + header pill re-render. */
  onChange?: (next: Segment) => void;
}

export function TrackCadenceControl({ segment, onChange }: Props): ReactElement | null {
  const [saving, setSaving] = useState(false);

  // Only predicate segments are recomputed/captured on a schedule; manual
  // segments are static pushes the cron skips, so a cadence picker is misleading.
  if (segment.type !== 'predicate') return null;

  const current: TrackCadence = segment.track_cadence ?? 'daily';
  const canEdit = segment.can_administer !== false;
  // Snapshots are captured only for game-bound predicate segments; otherwise
  // the same knob just drives the live recompute.
  const capturesHistory = Boolean(segment.game_id);

  async function choose(next: TrackCadence): Promise<void> {
    if (next === current || saving || !canEdit) return;
    setSaving(true);
    try {
      const updated = await segmentsClient.update(segment.id, { track_cadence: next });
      onChange?.(updated);
      message.success(`Tracking set to ${LABELS[next]}`);
    } catch (err) {
      message.error(err instanceof SegmentApiError ? err.message : 'Failed to update tracking cadence');
    } finally {
      setSaving(false);
    }
  }

  const hint = capturesHistory
    ? 'Recomputes the live member list AND writes a state + KPI snapshot each tick — the history below updates at this cadence.'
    : 'Recomputes the live member list each tick.';

  const showCostNote =
    capturesHistory && SUB_HOURLY.has(current) && segment.uid_count >= LARGE_SEGMENT;

  return (
    <div className={styles.cadenceControl}>
      <span className={styles.cadenceControlLabel}>Track every</span>
      <div
        className={styles.cadenceSegmented}
        role="radiogroup"
        aria-label="Track cadence"
        aria-busy={saving}
      >
        {TRACK_OPTIONS.map((opt) => {
          const selected = opt === current;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving || !canEdit}
              title={canEdit ? undefined : 'Owner or admin only'}
              className={[styles.cadenceSegment, selected ? styles.cadenceSegmentActive : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => void choose(opt)}
            >
              {LABELS[opt]}
            </button>
          );
        })}
      </div>
      <span className={styles.cadenceControlHint}>{hint}</span>
      {showCostNote && (
        <span className={styles.cadenceCostNote} role="note">
          Sub-hourly capture on a large cohort ({segment.uid_count.toLocaleString()} members)
          multiplies snapshot load.
        </span>
      )}
    </div>
  );
}
