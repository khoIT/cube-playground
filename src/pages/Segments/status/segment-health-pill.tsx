/**
 * Detail-header health pill — the single, consolidated badge that replaces the
 * old "Live · 60m" + "fresh" pair. One dot + one label, sourced from
 * resolveSegmentHealth so it can never drift from the library HEALTH column.
 *
 * When `onCadenceChange` is supplied and the segment is a healthy Live
 * predicate, the pill becomes a click target: a small popover lets the user
 * change the CAPTURE cadence inline. This PATCHes `track_cadence` — the single
 * operator knob; the server derives refresh_cadence_min + snapshot cadence from
 * it — so this pill is the one cadence editor (the legacy refresh-only editor is
 * retired). Distinct from Monitor's view-grain toggle (display downsample only).
 */

import { ReactElement, useState } from 'react';
import { Tooltip, Popover, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import type { Segment, TrackCadence } from '../../../types/segment-api';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import { resolveSegmentHealth } from './segment-health';
import styles from '../segments.module.css';

/** Capture-cadence options + labels. `Off` reads as "on-demand" (no background
 *  recompute/capture); everything else is a recompute + snapshot interval. */
const TRACK_OPTIONS: TrackCadence[] = ['Off', '15m', '30m', '1h', '3h', '6h', '12h', 'daily'];
const TRACK_LABELS: Record<TrackCadence, string> = {
  Off: 'On-demand', '15m': '15m', '30m': '30m', '1h': '1h', '3h': '3h', '6h': '6h', '12h': '12h', daily: 'Daily',
};
/** Short suffix for the pill label ("Live · daily"). */
const TRACK_SUFFIX: Record<TrackCadence, string> = {
  Off: 'on-demand', '15m': '15m', '30m': '30m', '1h': '1h', '3h': '3h', '6h': '6h', '12h': '12h', daily: 'daily',
};

interface Props {
  segment: Segment;
  /** When provided, a healthy Live segment's pill opens a cadence picker. */
  onCadenceChange?: (next: Segment) => void;
}

export function SegmentHealthPill({ segment, onCadenceChange }: Props): ReactElement {
  const { t } = useTranslation();
  const { tone, pill, tooltip, live } = resolveSegmentHealth(segment, t as never);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const canEdit =
    !!onCadenceChange && segment.type === 'predicate' && segment.status !== 'broken';

  const current: TrackCadence = segment.track_cadence ?? 'daily';
  // Editable pill reads as "{status} · {capture cadence}" off track_cadence;
  // non-editable (manual/broken) keeps the resolved health pill text.
  const statusWord = segment.type === 'manual'
    ? 'Static'
    : segment.status === 'refreshing'
      ? 'Refreshing'
      : live ? 'Live' : 'Stale';
  const headerLabel = canEdit ? `${statusWord} · ${TRACK_SUFFIX[current]}` : pill;

  const pillNode = (
    <span
      className={styles.healthPill}
      data-tone={tone}
      data-clickable={canEdit ? 'true' : undefined}
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
    >
      <span
        className={[styles.healthPillDot, live ? styles.healthPillDotLive : '']
          .filter(Boolean)
          .join(' ')}
        aria-hidden
      />
      {headerLabel}
      {canEdit && <ChevronDown size={12} aria-hidden style={{ opacity: 0.7, marginLeft: 1 }} />}
    </span>
  );

  if (!canEdit) {
    return <Tooltip title={tooltip}>{pillNode}</Tooltip>;
  }

  async function choose(next: TrackCadence): Promise<void> {
    if (next === current) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await segmentsClient.update(segment.id, { track_cadence: next });
      onCadenceChange?.(updated);
      setOpen(false);
      message.success(
        t('segments.library.health.cadence.updated', { defaultValue: 'Capture cadence updated' }),
      );
    } catch (err) {
      message.error(
        err instanceof SegmentApiError ? err.message : t('segments.library.health.cadence.failed', { defaultValue: 'Failed to update cadence' }),
      );
    } finally {
      setSaving(false);
    }
  }

  const content = (
    <div className={styles.cadenceMenu} role="menu" aria-busy={saving}>
      {TRACK_OPTIONS.map((opt) => {
        const selected = opt === current;
        return (
          <button
            key={opt}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            className={[styles.cadenceMenuItem, selected ? styles.cadenceMenuItemActive : '']
              .filter(Boolean)
              .join(' ')}
            disabled={saving}
            onClick={() => void choose(opt)}
          >
            <Check size={13} aria-hidden style={{ opacity: selected ? 1 : 0 }} />
            {TRACK_LABELS[opt]}
          </button>
        );
      })}
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      visible={open}
      onVisibleChange={setOpen}
      title={t('segments.library.health.cadence.title', { defaultValue: 'Capture cadence' })}
      content={content}
    >
      {pillNode}
    </Popover>
  );
}
