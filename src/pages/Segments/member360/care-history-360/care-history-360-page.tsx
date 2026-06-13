/**
 * Care History 360 page — `/segments/:id/members/:uid/care`.
 *
 * The deep per-member CS view drilled into from the segment Care watchlist.
 * Fetches the member's full ticket detail (transcript + ratings + labels + VIP +
 * recharge) and renders it as an Inbox (Variant A) or Timeline (Variant C),
 * toggleable. The existing config-driven Member360View is untouched — this is a
 * separate, CS-focused route. apiFetch + useEffect (not react-query), like the
 * other Segments tabs.
 */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchMemberCsTickets, type CsTicketsPayload } from '../../../../api/segment-cs-care-member';
import { SegmentApiError } from '../../../../api/api-client';
import { CareHistoryHeader, type CareView } from './care-history-header';
import { CareHistoryInboxView } from './care-history-inbox-view';
import { CareHistoryTimelineView } from './care-history-timeline-view';
import styles from './care-history-360.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; payload: CsTicketsPayload }
  | { kind: 'no-coverage' }
  | { kind: 'not-member' }
  | { kind: 'error'; message: string };

function Notice({ segmentId, children }: { segmentId?: string; children: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <main className={styles.page}>
      {segmentId && (
        <Link to={`/segments/${segmentId}?tab=care`} style={{ fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'none', display: 'inline-block', marginBottom: 12 }}>
          ← {t('segments.detail.care.backToCare', { defaultValue: 'Back to Care' })}
        </Link>
      )}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)', padding: 20, fontSize: 13, color: 'var(--text-secondary)' }}>
        {children}
      </div>
    </main>
  );
}

export function CareHistory360Page(): ReactElement {
  const { t } = useTranslation();
  const { id, uid: rawUid } = useParams<{ id: string; uid: string }>();
  // react-router v5 does not decode route params; recover the literal uid (numeric
  // jus uids pass through unchanged) before it feeds the fetch.
  const uid = useMemo(() => {
    try {
      return decodeURIComponent(rawUid);
    } catch {
      return rawUid;
    }
  }, [rawUid]);

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [view, setView] = useState<CareView>('inbox');
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    fetchMemberCsTickets(id, uid)
      .then((payload) => {
        if (cancelled) return;
        setState({ kind: 'ready', payload });
        setSelectedId(payload.tickets[0]?.ticketId ?? '');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof SegmentApiError && err.code === 'NO_CS_CARE') setState({ kind: 'no-coverage' });
        else if (err instanceof SegmentApiError && err.code === 'NOT_IN_SEGMENT') setState({ kind: 'not-member' });
        else setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load' });
      });
    return () => {
      cancelled = true;
    };
  }, [id, uid]);

  if (state.kind === 'loading') {
    return (
      <main className={styles.page}>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('segments.detail.care.loading', { defaultValue: 'Loading…' })}</div>
      </main>
    );
  }
  if (state.kind === 'no-coverage') {
    return <Notice segmentId={id}>{t('segments.detail.care.noCoverage', { defaultValue: 'CS care history is available only for games with CS coverage.' })}</Notice>;
  }
  if (state.kind === 'not-member') {
    return <Notice segmentId={id}>{t('segments.detail.care.notMember', { defaultValue: 'This member is not part of the segment.' })}</Notice>;
  }
  if (state.kind === 'error') {
    return <Notice segmentId={id}>{state.message}</Notice>;
  }

  const { payload } = state;
  return (
    <main className={styles.page}>
      <CareHistoryHeader payload={payload} view={view} onViewChange={setView} />
      {!payload.coverage.joined || payload.tickets.length === 0 ? (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)', padding: '28px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          {payload.coverage.note ?? t('segments.detail.care.noJoinable', { defaultValue: 'No joinable CS history for this member.' })}
        </div>
      ) : view === 'inbox' ? (
        <CareHistoryInboxView tickets={payload.tickets} selectedId={selectedId} onSelect={setSelectedId} />
      ) : (
        <CareHistoryTimelineView tickets={payload.tickets} selectedId={selectedId} onSelect={setSelectedId} />
      )}
    </main>
  );
}

export default CareHistory360Page;
