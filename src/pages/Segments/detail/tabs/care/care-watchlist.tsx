/**
 * Risk watchlist — the hero of the Care tab. Contacted whales sorted by risk
 * score (negative sentiment + low rating + open status + high-stakes category +
 * LTV rank). Each row:
 *   - the member NAME links to the Member 360 page (the shared profile view);
 *   - clicking the row toggles an inline expansion that LAZY-fetches the member's
 *     CS tickets and renders compact per-ticket summary cards, each with a
 *     "View full care history →" link into the Care History 360 page.
 * "The who-do-I-call-first list" for a CS / VIP-care lead, with a one-click peek.
 */

import { ReactElement, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { CsCareWatchlistEntry } from '../../../../../api/segment-cs-care';
import { fetchMemberCsTickets, type CsTicketDetail } from '../../../../../api/segment-cs-care-member';
import { Chip, Stars, fmtVnd, sentimentTone, statusTone } from './care-ui-atoms';
import { CareTicketSummaryCards } from './care-ticket-summary-cards';

interface Props {
  segmentId: string;
  rows: CsCareWatchlistEntry[];
}

const COLS = '1.6fr 92px 1fr 70px 96px 64px 100px 56px';

function HeadCell({ children, right }: { children: string; right?: boolean }): ReactElement {
  return <span style={{ textAlign: right ? 'right' : 'left' }}>{children}</span>;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function WatchlistRow({ segmentId, r }: { segmentId: string; r: CsCareWatchlistEntry }): ReactElement {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<LoadState>('idle');
  const [tickets, setTickets] = useState<CsTicketDetail[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function load(): Promise<void> {
    setState('loading');
    try {
      const p = await fetchMemberCsTickets(segmentId, r.uid);
      setTickets(p.tickets);
      setState('ready');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to load');
      setState('error');
    }
  }

  function toggle(): void {
    const next = !expanded;
    setExpanded(next);
    if (next && state === 'idle') void load();
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border-card)' }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        style={{
          display: 'grid',
          gridTemplateColumns: COLS,
          alignItems: 'center',
          gap: 12,
          padding: '11px 18px',
          fontSize: 12.5,
          cursor: 'pointer',
          background: expanded ? 'var(--surface-inset)' : 'transparent',
        }}
      >
        <span style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 6 }}>
          <ChevronRight
            size={14}
            aria-hidden
            style={{ flexShrink: 0, color: 'var(--text-muted)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
          />
          <span style={{ overflow: 'hidden' }}>
            <Link
              to={`/segments/${segmentId}/members/${encodeURIComponent(r.uid)}`}
              onClick={(e) => e.stopPropagation()}
              style={{ fontWeight: 600, color: 'var(--brand)', textDecoration: 'none' }}
            >
              {r.name ?? r.uid}
            </Link>
            {r.name && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.uid}
              </div>
            )}
          </span>
        </span>
        <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtVnd(r.ltv)}</span>
        <span style={{ color: 'var(--text-secondary)' }}>{r.lastCategory ?? '—'}</span>
        <span style={{ color: 'var(--text-muted)' }}>{r.lastSource || '—'}</span>
        <span>{r.sentiment ? <Chip tone={sentimentTone(r.sentiment)}>{r.sentiment}</Chip> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
        <span><Stars rating={r.rating} /></span>
        <span>{r.statusGroup ? <Chip tone={statusTone(r.statusGroup)}>{r.statusGroup}</Chip> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7 }}>
          <span style={{ width: 30, height: 5, borderRadius: 3, background: 'var(--border-card)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.min(100, r.riskScore)}%`, background: 'var(--brand)' }} />
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{r.riskScore}</span>
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '4px 18px 14px 38px', background: 'var(--surface-inset)' }}>
          {state === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2].map((n) => (
                <div key={n} style={{ height: 56, background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)', opacity: 0.6 }} />
              ))}
            </div>
          )}
          {state === 'error' && (
            <div style={{ fontSize: 12, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', padding: '8px 12px', borderRadius: 'var(--radius-md)' }}>
              {t('segments.detail.care.loadError', { defaultValue: 'Could not load CS tickets' })}: {errorMsg}
            </div>
          )}
          {state === 'ready' && <CareTicketSummaryCards segmentId={segmentId} uid={r.uid} tickets={tickets} />}
        </div>
      )}
    </div>
  );
}

export function CareWatchlist({ segmentId, rows }: Props): ReactElement {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return (
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          padding: '28px 16px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
      >
        {t('segments.detail.care.noContacts', { defaultValue: 'No members of this segment have joinable CS history.' })}
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: COLS,
          alignItems: 'center',
          gap: 12,
          padding: '11px 18px',
          background: 'var(--surface-inset)',
          borderBottom: '1px solid var(--border-card)',
          fontFamily: 'var(--font-alt)',
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
        }}
      >
        <HeadCell>{t('segments.detail.care.col.member', { defaultValue: 'Member' })}</HeadCell>
        <HeadCell right>{t('segments.detail.care.col.ltv', { defaultValue: 'LTV' })}</HeadCell>
        <HeadCell>{t('segments.detail.care.col.lastIssue', { defaultValue: 'Last issue' })}</HeadCell>
        <HeadCell>{t('segments.detail.care.col.channel', { defaultValue: 'Channel' })}</HeadCell>
        <HeadCell>{t('segments.detail.care.col.sentiment', { defaultValue: 'Sentiment' })}</HeadCell>
        <HeadCell>{t('segments.detail.care.col.rating', { defaultValue: 'Rating' })}</HeadCell>
        <HeadCell>{t('segments.detail.care.col.status', { defaultValue: 'Status' })}</HeadCell>
        <HeadCell right>{t('segments.detail.care.col.risk', { defaultValue: 'Risk' })}</HeadCell>
      </div>
      {rows.map((r) => (
        <WatchlistRow key={r.uid} segmentId={segmentId} r={r} />
      ))}
    </div>
  );
}
