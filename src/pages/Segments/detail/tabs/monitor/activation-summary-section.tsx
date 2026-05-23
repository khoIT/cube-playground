/**
 * Monitor tab — condensed activation summary. Same source data as
 * `ActivationTab` but compacted to fit alongside the chart + history sections.
 */

import { ReactElement } from 'react';
import { Button } from 'antd';
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import type { Segment } from '../../../../../types/segment-api';
import { useCollapsiblePref } from '../../cards/use-collapsible-pref';
import styles from '../../../segments.module.css';

interface Props {
  segment: Segment;
  onActivate?: () => void;
  onJumpToTab?: () => void;
}

function formatWhen(value: string | null): string {
  if (!value) return '—';
  try {
    return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function ActivationSummarySection({
  segment,
  onActivate,
  onJumpToTab,
}: Props): ReactElement {
  const { t } = useTranslation();
  const activations = segment.activations ?? [];
  const [collapsed, toggleCollapsed] = useCollapsiblePref(`monitor:activations:${segment.id}`);

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
          <h3>{t('segments.detail.monitor.activation.title', { defaultValue: 'Activations' })}</h3>
        </button>
        {!collapsed && (
          <Button type="primary" size="small" onClick={onActivate} disabled={!onActivate}>
            {t('segments.detail.monitor.activation.cta', { defaultValue: '+ Activate to CDP' })}
          </Button>
        )}
      </header>
      {collapsed ? null : activations.length === 0 ? (
        <div className={styles.monitorEmpty}>
          {t('segments.detail.monitor.activation.empty', {
            defaultValue: 'Not activated yet. Push to CDP to make this segment available downstream.',
          })}
        </div>
      ) : (
        <ul className={styles.activationSummaryList}>
          {activations.map((a) => (
            <li key={a.id}>
              <span className={styles.activationSummaryDest}>
                <ArrowRight size={11} aria-hidden /> {a.destination.toUpperCase()} · {a.env}
              </span>
              <span className={styles.activationSummaryMetric}>{a.metric_name}</span>
              <span className={styles.activationSummaryStatus} data-tone={
                a.status === 'active' ? 'success' : a.status === 'failed' ? 'destructive' : 'muted'
              }>{a.status}</span>
              <span className={styles.activationSummaryWhen}>{formatWhen(a.last_pushed_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {!collapsed && activations.length > 0 && onJumpToTab && (
        <button type="button" className={styles.monitorMoreLink} onClick={onJumpToTab}>
          {t('segments.detail.monitor.activation.viewAll', { defaultValue: 'View all activations →' })}
        </button>
      )}
    </section>
  );
}
