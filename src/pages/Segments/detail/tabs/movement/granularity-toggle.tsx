/**
 * View-time granularity picker for the Movement tab. Mirrors the monitor
 * cadence segmented control visually, but this changes only how the series is
 * downsampled for display — NOT the segment's capture cadence.
 *
 * Three-state, driven by the capture-coverage timeline:
 *  - full        — selectable, plain chip.
 *  - partial     — selectable, with a fine-tone under-rule; captured for only
 *                  part of the window, so the rest renders as carry-forward.
 *  - unavailable — disabled; the renderer could only fabricate detail.
 */

import { ReactElement } from 'react';
import {
  MOVEMENT_GRANULARITIES,
  type MovementGranularity,
} from '../../../../../api/segment-movement-client';
import { isGrainSelectable, type GrainAvailability } from './grain-availability';
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
  availability: Record<MovementGranularity, GrainAvailability>;
  onChange: (next: MovementGranularity) => void;
}

function chipTitle(g: MovementGranularity, a: GrainAvailability | undefined): string | undefined {
  if (!a || a.state === 'full') return undefined;
  if (a.state === 'partial') {
    const pct = Math.round(a.coveredFraction * 100);
    return `${LABELS[g]} captured for ~${pct}% of this window — selecting shows real detail where it exists; the rest holds flat between snapshots`;
  }
  return `No ${LABELS[g]} snapshots captured in this range`;
}

export function GranularityToggle({ value, availability, onChange }: Props): ReactElement {
  return (
    <div className={styles.cadenceSegmented} role="radiogroup" aria-label="View granularity">
      {MOVEMENT_GRANULARITIES.map((g) => {
        const a = availability[g];
        const selectable = isGrainSelectable(a);
        const selected = g === value;
        const partial = a?.state === 'partial';
        return (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!selectable}
            title={chipTitle(g, a)}
            className={[
              styles.cadenceSegment,
              selected ? styles.cadenceSegmentActive : '',
              partial ? styles.cadenceSegmentPartial : '',
            ]
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
