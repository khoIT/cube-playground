/**
 * Detail-header health pill — the single, consolidated badge that replaces the
 * old "Live · 60m" + "fresh" pair. One dot + one label, sourced from
 * resolveSegmentHealth so it can never drift from the library HEALTH column.
 *
 * When `onCadenceChange` is supplied and the segment is a healthy Live
 * predicate, the pill becomes a click target: a small popover lets the user
 * change the refresh cadence inline. This PATCHes only refresh_cadence_min
 * (a metadata-only update — no predicate re-run) and hands the updated segment
 * back to the parent.
 */

import { ReactElement, useState } from 'react';
import { Tooltip, Popover, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import type { Segment } from '../../../types/segment-api';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import { resolveSegmentHealth } from './segment-health';
import { cadenceOptionsFor } from '../refresh-cadence';
import styles from '../segments.module.css';

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
      {pill}
      {canEdit && <ChevronDown size={12} aria-hidden style={{ opacity: 0.7, marginLeft: 1 }} />}
    </span>
  );

  if (!canEdit) {
    return <Tooltip title={tooltip}>{pillNode}</Tooltip>;
  }

  const current = segment.refresh_cadence_min ?? 60;

  async function choose(min: number): Promise<void> {
    if (min === current) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const next = await segmentsClient.update(segment.id, { refresh_cadence_min: min });
      onCadenceChange?.(next);
      setOpen(false);
      message.success(
        t('segments.library.health.cadence.updated', { defaultValue: 'Cadence updated' }),
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
      {cadenceOptionsFor(current).map((opt) => {
        const selected = opt.value === current;
        return (
          <button
            key={opt.value}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            className={[styles.cadenceMenuItem, selected ? styles.cadenceMenuItemActive : '']
              .filter(Boolean)
              .join(' ')}
            disabled={saving}
            onClick={() => void choose(opt.value)}
          >
            <Check size={13} aria-hidden style={{ opacity: selected ? 1 : 0 }} />
            {opt.label}
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
      title={t('segments.library.health.cadence.title', { defaultValue: 'Refresh cadence' })}
      content={content}
    >
      {pillNode}
    </Popover>
  );
}
