/**
 * Snapshot CAPTURE cadence control — sets how often the lakehouse snapshot job
 * materializes this segment (15m–daily). This is distinct from the view-time
 * granularity toggle (which only downsamples already-captured points) and from
 * the Monitor tab's refresh cadence (cohort recompute). Editor-gated: the PATCH
 * is owner/admin-only server-side, so non-administrators see it disabled.
 */

import { ReactElement, useState } from 'react';
import { message } from 'antd';
import type { Segment, SnapshotCadence } from '../../../../../types/segment-api';
import { segmentsClient } from '../../../../../api/segments-client';
import { SegmentApiError } from '../../../../../api/api-client';
import { MOVEMENT_GRANULARITIES } from '../../../../../api/segment-movement-client';
import styles from '../../../segments.module.css';

const LABELS: Record<SnapshotCadence, string> = {
  daily: 'Daily',
  '12h': '12h',
  '6h': '6h',
  '3h': '3h',
  '1h': '1h',
  '15m': '15m',
};

interface Props {
  segment: Segment;
  /** Hands back the updated segment so the tab + header re-render. */
  onChange?: (next: Segment) => void;
}

export function SnapshotCadenceControl({ segment, onChange }: Props): ReactElement {
  const [saving, setSaving] = useState(false);
  const current: SnapshotCadence = segment.snapshot_cadence ?? 'daily';
  const canEdit = segment.can_administer !== false;

  async function choose(next: SnapshotCadence): Promise<void> {
    if (next === current || saving || !canEdit) return;
    setSaving(true);
    try {
      const updated = await segmentsClient.update(segment.id, { snapshot_cadence: next });
      onChange?.(updated);
      message.success(`Snapshot capture set to ${LABELS[next]}`);
    } catch (err) {
      message.error(err instanceof SegmentApiError ? err.message : 'Failed to update capture cadence');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '10px 14px',
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Snapshot capture</span>
      <div className={styles.cadenceSegmented} role="radiogroup" aria-label="Snapshot capture cadence" aria-busy={saving}>
        {MOVEMENT_GRANULARITIES.map((g) => {
          const selected = g === current;
          return (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving || !canEdit}
              title={canEdit ? undefined : 'Owner or admin only'}
              className={[styles.cadenceSegment, selected ? styles.cadenceSegmentActive : ''].filter(Boolean).join(' ')}
              onClick={() => void choose(g as SnapshotCadence)}
            >
              {LABELS[g]}
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, minWidth: 180 }}>
        Changes how often this segment is captured — not just the view. Sub-daily increases snapshot load.
      </span>
    </div>
  );
}
