/**
 * Care tab — CS-overlay for VIP/whale segments. Watchlist-first layout: a slim
 * pulse strip on top, then the risk watchlist as the hero with issue-mix +
 * recharge-impact on a right rail. Data from GET /api/segments/:id/cs-care.
 *
 * Gated to games with CS coverage (the tab is hidden elsewhere); a NO_CS_CARE
 * 404 still renders a no-coverage notice rather than an error, and a recharge
 * failure degrades to a hidden impact strip (csImpact === null) without 502-ing
 * the rest of the overlay.
 */

import { ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchSegmentCsCare, type CsCarePayload } from '../../../../api/segment-cs-care';
import { SegmentApiError } from '../../../../api/api-client';
import type { Segment } from '../../../../types/segment-api';
import { CarePulseStrip } from './care/care-pulse-strip';
import { CareWatchlist } from './care/care-watchlist';
import { CareIssueMix } from './care/care-issue-mix';
import { CareImpactStrip } from './care/care-impact-strip';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
}

/** Format the last-good timestamp in GMT+7 (the ops timezone) for the badge. */
function formatStaleTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Asia/Saigon',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: CsCarePayload }
  | { kind: 'no-coverage' }
  | { kind: 'error'; message: string };

export function CareTab({ segment }: Props): ReactElement {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    fetchSegmentCsCare(segment.id)
      .then((data) => {
        if (!cancelled) setState({ kind: 'ready', data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // NO_CS_CARE (predicate/coverage gate) is an expected "no overlay" state,
        // not a failure — show the notice instead of an error banner.
        if (err instanceof SegmentApiError && (err.status === 404 || err.code === 'NO_CS_CARE')) {
          setState({ kind: 'no-coverage' });
          return;
        }
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [segment.id]);

  if (state.kind === 'loading') {
    return (
      <div className={styles.careTab}>
        <div className={styles.skeletonRow} style={{ height: 56 }} />
        <div className={styles.skeletonRow} style={{ height: 280, marginTop: 16 }} />
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
          {t('segments.detail.care.computing', { defaultValue: 'Reading CS history…' })}
        </div>
      </div>
    );
  }

  if (state.kind === 'no-coverage') {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyStateText}>
          {t('segments.detail.care.noCoverage', {
            defaultValue: 'CS history overlay is available for predicate segments of games connected to the CS warehouse.',
          })}
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return <div className={styles.errorState}>{state.message}</div>;
  }

  const { data } = state;
  return (
    <div className={styles.careTab}>
      {data.stale && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 12,
            borderRadius: 'var(--radius-md)',
            background: 'var(--warning-soft)',
            color: 'var(--warning-ink)',
          }}
        >
          {t('segments.detail.care.stale', {
            defaultValue: 'Showing last-good data as of {{time}} — a fresh read is temporarily unavailable.',
            time: formatStaleTime(data.stale.computedAt),
          })}
        </div>
      )}
      <CarePulseStrip
        coverage={data.coverage}
        pulse={data.pulse}
        freshnessDate={data.freshness.csMaxLogDate}
        segmentSize={segment.uid_count}
      />
      <div className={styles.careRail}>
        <CareWatchlist segmentId={segment.id} rows={data.watchlist} />
        <div className={styles.careRailSide}>
          <CareIssueMix issueMix={data.issueMix} />
          {data.csImpact && <CareImpactStrip impact={data.csImpact} />}
        </div>
      </div>
    </div>
  );
}
