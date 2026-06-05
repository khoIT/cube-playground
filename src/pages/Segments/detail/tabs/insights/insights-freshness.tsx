/**
 * Tab-level freshness line for the Insights view. Reads the segment's
 * precomputed card cache and summarises (a) how recently the cards were
 * computed and (b) whether any failed to refresh. One subtle caption beats a
 * timestamp on every one of ~30 tiles — and it closes the loop on the
 * server-side ISO-Z `fetched_at` + per-card status now stored in the cache.
 *
 * Renders nothing when the segment has no card cache at all (e.g. manual
 * segments, which are live-fetched by design) — there's no "as of" to show.
 */

import { ReactElement } from 'react';
import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import { AlertTriangle, Clock } from 'lucide-react';
import type { Segment } from '../../../../../types/segment-api';
import styles from '../../../segments.module.css';

interface Props {
  segment: Segment;
}

export interface FreshnessSummary {
  /** ISO timestamp of the most recently computed card, or null when no cache. */
  newest: string | null;
  /** Number of cached cards whose last precompute failed. */
  errorCount: number;
}

export function summariseCardFreshness(cache: Segment['card_cache']): FreshnessSummary {
  if (!cache) return { newest: null, errorCount: 0 };
  let newestMs = -Infinity;
  let newest: string | null = null;
  let errorCount = 0;
  for (const entry of Object.values(cache)) {
    if (entry.status === 'error') errorCount += 1;
    const ms = new Date(entry.fetched_at).getTime();
    if (!Number.isNaN(ms) && ms > newestMs) {
      newestMs = ms;
      newest = entry.fetched_at;
    }
  }
  return { newest, errorCount };
}

function formatWhen(value: string): string {
  try {
    return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function InsightsFreshness({ segment }: Props): ReactElement | null {
  const { t } = useTranslation();
  const { newest, errorCount } = summariseCardFreshness(segment.card_cache);

  // No precomputed cache → cards run live; nothing to caption.
  if (!newest) return null;

  return (
    <div className={styles.insightsFreshness}>
      <Tooltip title={new Date(newest).toLocaleString()}>
        <span className={styles.insightsFreshnessWhen}>
          <Clock size={12} aria-hidden />
          {t('segments.detail.insights.freshness.asOf', {
            defaultValue: 'Updated {{when}}',
            when: formatWhen(newest),
          })}
        </span>
      </Tooltip>
      {errorCount > 0 && (
        <span className={styles.insightsFreshnessError} data-tone="warning">
          <AlertTriangle size={12} aria-hidden />
          {t('segments.detail.insights.freshness.errors', {
            defaultValue: '{{count}} couldn’t refresh · showing live data',
            count: errorCount,
          })}
        </span>
      )}
    </div>
  );
}
