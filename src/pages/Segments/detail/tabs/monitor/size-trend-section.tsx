/**
 * Monitor tab — size trend section. Renders headline count + delta + line/area
 * chart over a configurable day range from the refresh-log endpoint.
 */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from 'antd';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { segmentsClient } from '../../../../../api/segments-client';
import type { RefreshLogRow, Segment } from '../../../../../types/segment-api';
import { useCollapsiblePref } from '../../cards/use-collapsible-pref';
import styles from '../../../segments.module.css';

interface Props {
  segment: Segment;
}

const W = 720;
const H = 160;
const PAD_X = 8;
const PAD_Y = 12;

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function buildPaths(values: number[]) {
  if (values.length < 2) return { line: '', area: '' };
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = Math.max(1, maxV - minV);
  const stepX = (W - PAD_X * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = PAD_X + i * stepX;
    const norm = (v - minV) / range;
    const y = H - PAD_Y - norm * (H - PAD_Y * 2);
    return { x, y };
  });
  let line = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    line += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  const area = `${line} L ${points[points.length - 1].x.toFixed(2)} ${H - PAD_Y} L ${points[0].x.toFixed(2)} ${H - PAD_Y} Z`;
  return { line, area };
}

export function SizeTrendSection({ segment }: Props): ReactElement {
  const { t } = useTranslation();
  const [days, setDays] = useState(7);
  const [log, setLog] = useState<RefreshLogRow[]>([]);
  const [collapsed, toggleCollapsed] = useCollapsiblePref(`monitor:size-trend:${segment.id}`);

  useEffect(() => {
    let cancelled = false;
    segmentsClient
      .refreshLog(segment.id, days, 500)
      .then((rows) => {
        if (!cancelled) setLog(rows);
      })
      .catch(() => {
        if (!cancelled) setLog([]);
      });
    return () => {
      cancelled = true;
    };
  }, [segment.id, days]);

  const values = useMemo(() => log.map((r) => r.uid_count), [log]);
  const paths = useMemo(() => buildPaths(values), [values]);

  const first = values[0] ?? segment.uid_count;
  const last = values[values.length - 1] ?? segment.uid_count;
  const delta = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  const deltaSign = delta > 0 ? '+' : '';

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
          <div>
            <h3>{t('segments.detail.monitor.size.title', { defaultValue: 'Size trend' })}</h3>
            {!collapsed && (
              <div className={styles.monitorHeadline}>
                <span className={styles.monitorCount}>{formatCount(last)}</span>
                <span className={styles.monitorDelta} data-tone={delta >= 0 ? 'success' : 'destructive'}>
                  {deltaSign}
                  {delta}% vs {days}d ago
                </span>
              </div>
            )}
          </div>
        </button>
        {!collapsed && (
          <Select
            size="small"
            value={days}
            onChange={(v) => setDays(v)}
            options={[
              { value: 7, label: '7 days' },
              { value: 30, label: '30 days' },
              { value: 90, label: '90 days' },
            ]}
            style={{ width: 120 }}
          />
        )}
      </header>
      {collapsed ? null : paths.line ? (
        <svg
          className={styles.monitorChart}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t('segments.detail.monitor.size.aria', {
            defaultValue: 'Size trend chart over {{days}} days',
            days,
          })}
          preserveAspectRatio="none"
        >
          <path d={paths.area} fill="var(--chart-1)" opacity="0.10" />
          <path d={paths.line} fill="none" stroke="var(--chart-1)" strokeWidth={1.75} strokeLinejoin="round" />
        </svg>
      ) : (
        <div className={styles.monitorEmpty}>
          {t('segments.detail.monitor.size.empty', {
            defaultValue: 'Not enough refresh history yet — chart appears after the first 2 successful refreshes.',
          })}
        </div>
      )}
    </section>
  );
}
