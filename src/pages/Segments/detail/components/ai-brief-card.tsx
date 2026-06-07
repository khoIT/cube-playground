/**
 * Collapsible AI Brief card — LLM-written executive narrative rendered between
 * the KPI strip and the tab strip on segment open. Lazy: a collapsed card
 * issues no fetch until expanded. The byline ("AI-generated · estimated …")
 * is mandatory in every state that shows a narrative, and `limited` coverage
 * always carries an explicit disclaimer chip — both are product requirements,
 * not decoration. Narrative/signals render as PLAIN TEXT only (LLM output is
 * never interpreted as markup).
 */

import { ReactElement, useEffect, useState } from 'react';
import { Button } from 'antd';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import type { SegmentBriefPayload } from '../../../../api/segments-client';
import { useSegmentBrief } from './use-segment-brief';
import styles from '../../segments.module.css';

const COLLAPSE_KEY = 'gds-cube:segment-brief-collapsed';

/** Semantic-token pair per brief label (chip background / text). */
const LABEL_TONES: Record<SegmentBriefPayload['label'], { bg: string; ink: string }> = {
  high_value_churn_risk: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)' },
  upsell_candidate: { bg: 'var(--info-soft)', ink: 'var(--info-ink)' },
  engaged_non_payer: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
  healthy_growth_cohort: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
  new_user_wave: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
};

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function relative(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function AiBriefCard({ segmentId }: { segmentId: string }): ReactElement {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { state, retry } = useSegmentBrief(segmentId, !collapsed);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* private mode — collapse state just won't persist */
    }
  }, [collapsed]);

  const brief = state.phase === 'ok' ? state.brief : null;

  return (
    <section className={styles.briefCard} aria-label={t('segments.detail.brief.title')}>
      <div className={styles.briefHeaderRow}>
        <span className={styles.briefTitle}>
          <Sparkles size={12} aria-hidden />
          {t('segments.detail.brief.title')}
        </span>
        {brief && (
          <span
            className={styles.briefChip}
            style={{ background: LABEL_TONES[brief.label].bg, color: LABEL_TONES[brief.label].ink }}
          >
            {t(`segments.detail.brief.labels.${brief.label}`)}
          </span>
        )}
        {brief?.data_coverage === 'limited' && (
          <span
            className={styles.briefChip}
            style={{ background: 'var(--muted-soft)', color: 'var(--muted-ink)' }}
          >
            {t('segments.detail.brief.limited')}
          </span>
        )}
        {state.phase === 'ok' && state.stale && (
          <span
            className={styles.briefChip}
            style={{ background: 'var(--warning-soft)', color: 'var(--warning-ink)' }}
          >
            {t('segments.detail.brief.stale')}
          </span>
        )}
        <button
          type="button"
          className={styles.briefCollapseBtn}
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? t('segments.detail.brief.expand')
              : t('segments.detail.brief.collapse')
          }
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <ChevronDown size={13} aria-hidden /> : <ChevronUp size={13} aria-hidden />}
        </button>
      </div>

      {!collapsed && state.phase === 'loading' && (
        <div className={styles.briefSkeleton} data-testid="brief-skeleton">
          <div className={styles.skeletonRow} style={{ width: '92%', height: 12 }} />
          <div className={styles.skeletonRow} style={{ width: '78%', height: 12 }} />
          <div className={styles.skeletonRow} style={{ width: '55%', height: 12 }} />
        </div>
      )}

      {!collapsed && state.phase === 'error' && (
        <div className={styles.briefErrorRow}>
          <span>{t('segments.detail.brief.error')}</span>
          <Button size="small" onClick={retry}>
            {t('segments.detail.brief.retry')}
          </Button>
        </div>
      )}

      {!collapsed && brief && (
        <>
          <p className={styles.briefNarrative}>{brief.narrative}</p>
          <ul className={styles.briefSignals}>
            {brief.signals.map((signal, i) => (
              <li key={i} className={styles.briefSignal}>
                <span className={styles.briefSignalDot} aria-hidden />
                {signal}
              </li>
            ))}
          </ul>
          <div className={styles.briefByline}>
            {t('segments.detail.brief.byline', {
              // Not named `count`: that key would arm i18next plural resolution
              // (byline_one/_other lookups) — keep the byline a single string.
              memberCount: brief.member_count.toLocaleString(),
              when: relative(brief.generated_at),
            })}
          </div>
        </>
      )}
    </section>
  );
}
