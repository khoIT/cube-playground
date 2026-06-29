/**
 * Monitor tab — refresh history (50-row table) of `segment_refresh_log`.
 */

import { ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { segmentsClient } from '../../../../../api/segments-client';
import type { RefreshLogRow, Segment } from '../../../../../types/segment-api';
import { useCollapsiblePref } from '../../cards/use-collapsible-pref';
import styles from '../../../segments.module.css';

interface Props {
  segment: Segment;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

// Exact local time (renders in the viewer's timezone — GMT+7 here) so a burst
// of same-day refreshes is distinguishable to the minute instead of collapsing
// to "1 day ago".
function formatWhenAbsolute(value: string | null): string {
  if (!value) return '—';
  try {
    return format(new Date(value), 'd MMM, HH:mm');
  } catch {
    return '—';
  }
}

function formatWhenRelative(value: string | null): string | null {
  if (!value) return null;
  try {
    return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
  } catch {
    return null;
  }
}

// Trigger label + chip tone. 'create'/'edit' are one-off kick-offs; 'cron' is
// the scheduled cadence; 'manual' is the explicit Refresh-now button. Rows that
// predate source tracking report 'unknown'.
function sourceMeta(
  source: string | undefined,
  t: (k: string, o: { defaultValue: string }) => string,
): { label: string; tone: 'cron' | 'manual' | 'create' | 'edit' | 'unknown' } {
  switch (source) {
    case 'cron':
      return { label: t('segments.detail.monitor.history.source.cron', { defaultValue: 'Scheduled' }), tone: 'cron' };
    case 'manual':
      return { label: t('segments.detail.monitor.history.source.manual', { defaultValue: 'Manual' }), tone: 'manual' };
    case 'create':
      return { label: t('segments.detail.monitor.history.source.create', { defaultValue: 'On create' }), tone: 'create' };
    case 'edit':
      return { label: t('segments.detail.monitor.history.source.edit', { defaultValue: 'On edit' }), tone: 'edit' };
    default:
      return { label: t('segments.detail.monitor.history.source.unknown', { defaultValue: 'Unknown' }), tone: 'unknown' };
  }
}

export function RefreshHistorySection({ segment }: Props): ReactElement {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RefreshLogRow[]>([]);
  const [collapsed, toggleCollapsed] = useCollapsiblePref(`monitor:refresh-history:${segment.id}`);

  useEffect(() => {
    let cancelled = false;
    segmentsClient
      .refreshLog(segment.id, 30, 50)
      .then((data) => {
        if (!cancelled) {
          // Most recent first for the history table.
          setRows([...data].reverse());
        }
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [segment.id]);

  return (
    <section className={styles.monitorSection}>
      <header className={styles.monitorSectionHead}>
        <button
          type="button"
          className={styles.cardCollapseBtn}
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          <h3>{t('segments.detail.monitor.history.title', { defaultValue: 'Refresh history' })}</h3>
        </button>
      </header>
      {collapsed ? null : rows.length === 0 ? (
        <div className={styles.monitorEmpty}>
          {t('segments.detail.monitor.history.empty', {
            defaultValue: 'No refreshes recorded yet.',
          })}
        </div>
      ) : (
        <div className={styles.refreshHistoryTable}>
          <div className={styles.refreshHistoryHead}>
            <span>{t('segments.detail.monitor.history.col.when', { defaultValue: 'When' })}</span>
            <span>{t('segments.detail.monitor.history.col.trigger', { defaultValue: 'Trigger' })}</span>
            <span>{t('segments.detail.monitor.history.col.status', { defaultValue: 'Status' })}</span>
            <span>{t('segments.detail.monitor.history.col.size', { defaultValue: 'Size' })}</span>
            <span>{t('segments.detail.monitor.history.col.delta', { defaultValue: 'Δ' })}</span>
          </div>
          {rows.map((r, i) => {
            const prev = rows[i + 1];
            const delta = prev ? r.uid_count - prev.uid_count : 0;
            const sign = delta > 0 ? '+' : '';
            const tone =
              r.status === 'broken' ? 'destructive' : r.status === 'fresh' ? 'success' : 'muted';
            const src = sourceMeta(r.source, t);
            const relative = formatWhenRelative(r.ts);
            return (
              <div key={r.id} className={styles.refreshHistoryRow}>
                <span className={styles.refreshHistoryWhen} title={relative ?? undefined}>
                  <span>{formatWhenAbsolute(r.ts)}</span>
                  {relative && <span className={styles.refreshHistoryWhenRel}>{relative}</span>}
                </span>
                <span className={styles.refreshHistorySource} data-tone={src.tone}>{src.label}</span>
                <span className={styles.refreshHistoryStatus} data-tone={tone}>{r.status}</span>
                <span className={styles.refreshHistorySize}>{formatCount(r.uid_count)}</span>
                <span className={styles.refreshHistoryDelta} data-sign={delta >= 0 ? 'pos' : 'neg'}>
                  {prev ? `${sign}${formatCount(Math.abs(delta))}` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
