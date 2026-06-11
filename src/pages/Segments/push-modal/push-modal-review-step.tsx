/**
 * Step 1 of the push-modal guided rail: "Review what you selected".
 *
 * Renders the selected cohort as loud brand-soft chips plus a plain-English
 * restatement (with the weekday for single-day cohorts) so the user verifies
 * WHAT they are saving before naming it — designed against a real incident
 * where the wrong day's row was saved unnoticed.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { Query } from '@cubejs-client/core';
import type { SelectionSummaryResult } from './selection-summary';
import { parseColumnLabel, formatCategoricalValue } from './format-selection-summary';
import { weekdayRestatement } from './suggest-segment-name';
import styles from '../segments.module.css';

interface Props {
  summary: SelectionSummaryResult;
  granularityByCol: Record<string, string | undefined>;
  cube: string | null;
  executedQuery?: Query | null;
  /** True when uids materialize at save (cohort/expansion mode). */
  expansionPending?: boolean;
  /** uid-mode count (rows ARE users); ignored when expansionPending. */
  uidCount: number;
}

/** "2026-05-31 → 2026-06-06 · day" from the first ranged time dimension. */
function describeQueryWindow(executedQuery?: Query | null): string | null {
  const td = (executedQuery?.timeDimensions ?? []).find((t) => t.dateRange);
  if (!td) return null;
  const range = Array.isArray(td.dateRange)
    ? `${td.dateRange[0]} → ${td.dateRange[1]}`
    : String(td.dateRange);
  return td.granularity ? `${range} · ${td.granularity}` : range;
}

export function PushModalReviewStep({
  summary,
  granularityByCol,
  cube,
  executedQuery,
  expansionPending,
  uidCount,
}: Props): ReactElement {
  const { t } = useTranslation();
  const window = describeQueryWindow(executedQuery);
  const scope = [cube, window].filter(Boolean).join(' · ');
  // Cube-level segments scoping the query (e.g. mf_users.whales) — part of
  // WHAT is being saved, so they must appear in the review chips alongside
  // the selected cohort values. Strip the cube prefix for readability.
  const cubeSegments = (executedQuery?.segments ?? []).map((s) => {
    const dot = s.indexOf('.');
    return dot >= 0 ? s.slice(dot + 1) : s;
  });

  // Weekday restatement: only when the whole selection is one single-valued
  // day-grain cohort — anything broader and a one-day phrase would mislead.
  const soleDay =
    summary.total === 1 &&
    summary.categoricals.length >= 1 &&
    summary.categoricals.every((c) => c.topValues.length === 1)
      ? summary.categoricals
          .map((c) => {
            const { granularity } = parseColumnLabel(c.column, granularityByCol);
            return granularity === 'day' ? weekdayRestatement(c.topValues[0].value) : null;
          })
          .find(Boolean) ?? null
      : null;

  return (
    <div className={styles.pushReviewCard}>
      {summary.categoricals.length > 0 || cubeSegments.length > 0 ? (
        <div className={styles.pushChips}>
          {cubeSegments.map((s) => (
            <span key={`segment:${s}`} className={styles.pushChip}>
              <span className={styles.pushChipKey}>
                {t('segments.push.reviewSegmentChipKey', { defaultValue: 'segment' })}
              </span>
              {s}
            </span>
          ))}
          {summary.categoricals.map((c) => {
            const label = parseColumnLabel(c.column, granularityByCol);
            return c.topValues.map((v) => (
              <span key={`${c.column}:${v.value}`} className={styles.pushChip}>
                <span className={styles.pushChipKey}>{label.member}</span>
                {formatCategoricalValue(v.value, label.granularity)}
              </span>
            ));
          })}
        </div>
      ) : (
        <div className={styles.pushScopeRow}>
          {t('segments.push.reviewWholeQuery', {
            defaultValue: 'Whole query result — no cohort filter',
          })}
        </div>
      )}

      {scope && (
        <div className={styles.pushScopeRow}>
          {t('segments.push.reviewWithin', { defaultValue: 'within' })}{' '}
          <span className={styles.pushScopeMono}>{scope}</span>
        </div>
      )}

      <div className={styles.pushScopeRow}>
        {expansionPending ? (
          soleDay ? (
            <>
              {t('segments.push.reviewDayCohort', { defaultValue: 'everyone matching on' })}{' '}
              <strong className={styles.pushScopeStrong}>{soleDay}</strong>
              {' — '}
              {t('segments.push.reviewExpands', { defaultValue: 'user_ids expand at save' })}
            </>
          ) : (
            <>
              {t('segments.selectionBar.cohortsSelected', {
                count: summary.total,
                defaultValue: '{{count}} cohort(s) selected — user_ids expand at save',
              })}
            </>
          )
        ) : (
          t('segments.push.summaryPredicate', {
            count: uidCount,
            defaultValue:
              '{{count}} user_ids in current result — segment refreshes against the query predicate',
          })
        )}
      </div>
    </div>
  );
}
