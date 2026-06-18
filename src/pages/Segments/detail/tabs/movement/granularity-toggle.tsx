/**
 * View-time granularity picker for the Movement tab. Mirrors the monitor
 * cadence segmented control visually, but this changes only how the series is
 * downsampled for display — NOT the segment's capture cadence. Options finer
 * than what was captured in the window (`effective`) are disabled with a
 * tooltip, since the renderer can only carry-forward, never fabricate, detail.
 */

import { ReactElement } from 'react';
import {
  MOVEMENT_GRANULARITIES,
  isGranularitySelectable,
  type MovementGranularity,
} from '../../../../../api/segment-movement-client';
import styles from '../../../segments.module.css';

const LABELS: Record<MovementGranularity, string> = {
  daily: 'Daily',
  '12h': '12h',
  '6h': '6h',
  '3h': '3h',
  '1h': '1h',
  '15m': '15m',
};

interface Props {
  value: MovementGranularity;
  effective: MovementGranularity;
  onChange: (next: MovementGranularity) => void;
}

export function GranularityToggle({ value, effective, onChange }: Props): ReactElement {
  return (
    <div className={styles.cadenceSegmented} role="radiogroup" aria-label="View granularity">
      {MOVEMENT_GRANULARITIES.map((g) => {
        const selectable = isGranularitySelectable(g, effective);
        const selected = g === value;
        return (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!selectable}
            title={selectable ? undefined : `Captured no finer than ${LABELS[effective]} in this range`}
            className={[styles.cadenceSegment, selected ? styles.cadenceSegmentActive : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => selectable && !selected && onChange(g)}
          >
            {LABELS[g]}
          </button>
        );
      })}
    </div>
  );
}
