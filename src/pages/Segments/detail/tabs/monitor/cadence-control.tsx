/**
 * Monitor-tab auto-refresh frequency picker. Surfaces refresh cadence as an
 * always-visible segmented control (more affordant than the header pill's
 * popover) right where users reason about refresh load. Picking a value PATCHes
 * `refresh_cadence_min` — the cron honours it on its next tick; longer
 * intervals (or Off) reduce background load. Off → null (on-demand only).
 *
 * Shares the cadence option set with the header pill via cadenceOptionsFor, and
 * hands the updated segment back so the header pill stays in sync (single
 * source of truth — both read/write refresh_cadence_min).
 */

import { ReactElement, useState } from 'react';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Segment } from '../../../../../types/segment-api';
import { segmentsClient } from '../../../../../api/segments-client';
import { SegmentApiError } from '../../../../../api/api-client';
import { cadenceOptionsFor, cadenceShortLabel } from '../../../refresh-cadence';
import styles from '../../../segments.module.css';

interface Props {
  segment: Segment;
  /** Hands back the updated segment so the header health pill re-renders. */
  onCadenceChange?: (next: Segment) => void;
}

export function CadenceControl({ segment, onCadenceChange }: Props): ReactElement | null {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  // Only predicate segments auto-refresh; manual segments are static pushes the
  // cron skips, so a cadence picker would be misleading there.
  if (segment.type !== 'predicate') return null;

  const current = segment.refresh_cadence_min; // number | null (null = off)

  async function choose(min: number | null): Promise<void> {
    if (min === current || saving) return;
    setSaving(true);
    try {
      const next = await segmentsClient.update(segment.id, { refresh_cadence_min: min });
      onCadenceChange?.(next);
      message.success(
        t('segments.library.health.cadence.updated', { defaultValue: 'Cadence updated' }),
      );
    } catch (err) {
      message.error(
        err instanceof SegmentApiError
          ? err.message
          : t('segments.library.health.cadence.failed', { defaultValue: 'Failed to update cadence' }),
      );
    } finally {
      setSaving(false);
    }
  }

  const buttons: Array<{ key: string; value: number | null; label: string }> = [
    { key: 'off', value: null, label: t('segments.detail.monitor.cadence.off', { defaultValue: 'Off' }) },
    ...cadenceOptionsFor(current ?? 60).map((o) => ({
      key: String(o.value),
      value: o.value as number | null,
      label: cadenceShortLabel(o.value),
    })),
  ];

  return (
    <div className={styles.cadenceControl}>
      <span className={styles.cadenceControlLabel}>
        {t('segments.detail.monitor.cadence.label', { defaultValue: 'Auto-refresh' })}
      </span>
      <div className={styles.cadenceSegmented} role="radiogroup" aria-busy={saving}>
        {buttons.map((b) => {
          const selected = b.value === current;
          return (
            <button
              key={b.key}
              type="button"
              role="radio"
              aria-checked={selected}
              className={[styles.cadenceSegment, selected ? styles.cadenceSegmentActive : '']
                .filter(Boolean)
                .join(' ')}
              disabled={saving}
              onClick={() => void choose(b.value)}
            >
              {b.label}
            </button>
          );
        })}
      </div>
      <span className={styles.cadenceControlHint}>
        {current == null
          ? t('segments.detail.monitor.cadence.hintOff', {
              defaultValue: 'On-demand only — no background load',
            })
          : t('segments.detail.monitor.cadence.hint', {
              defaultValue: 'Less frequent = lighter backend load',
            })}
      </span>
    </div>
  );
}
