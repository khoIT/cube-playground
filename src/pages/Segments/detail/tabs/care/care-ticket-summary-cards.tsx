/**
 * Row-expand content for a watchlist member: compact per-ticket summary cards
 * (NO transcript — that lives on the Care History 360 page). Each card shows the
 * AI-label chips, sentiment, ★rating, status, reopen/security badges, opened
 * date, message count, and a stripped last-message snippet. A "View full care
 * history →" link drills to the page.
 *
 * Lazy: the parent fetches `fetchMemberCsTickets` only when a row is expanded.
 */

import { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, RotateCcw, ArrowUpRight } from 'lucide-react';
import type { CsTicketDetail } from '../../../../../api/segment-cs-care-member';
import { Chip, Stars, sentimentTone, statusTone } from './care-ui-atoms';

interface Props {
  segmentId: string;
  uid: string;
  tickets: CsTicketDetail[];
}

function lastSnippet(t: CsTicketDetail, max = 150): string | null {
  const last = t.messages[t.messages.length - 1];
  if (!last?.text) return null;
  return last.text.length > max ? `${last.text.slice(0, max).trimEnd()}…` : last.text;
}

function badgeStyle(bg: string, ink: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    background: bg,
    color: ink,
    borderRadius: 'var(--radius-full)',
    padding: '1px 7px',
    fontSize: 10.5,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };
}

export function CareTicketSummaryCards({ segmentId, uid, tickets }: Props): ReactElement {
  const { t } = useTranslation();

  if (tickets.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 2px' }}>
        {t('segments.detail.care.noJoinable', {
          defaultValue: 'No joinable CS tickets for this member (Facebook/AIHelp tickets are unjoinable).',
        })}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tickets.map((tk) => {
        const snippet = lastSnippet(tk);
        return (
          <div
            key={tk.ticketId}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                {tk.openedAt}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tk.source || '—'}</span>
              {tk.status && <Chip tone={statusTone(tk.status)}>{tk.status}</Chip>}
              {tk.sentiment.last && <Chip tone={sentimentTone(tk.sentiment.last)}>{tk.sentiment.last}</Chip>}
              <Stars rating={tk.rating?.rating ?? null} />
              {tk.reopenCount > 0 && (
                <span style={badgeStyle('var(--warning-soft)', 'var(--warning-ink)')} title={t('segments.detail.care.reopens', { defaultValue: 'Reopened {{n}}×', n: tk.reopenCount })}>
                  <RotateCcw size={11} aria-hidden /> {tk.reopenCount}×
                </span>
              )}
              {tk.securityFlag && (
                <span style={badgeStyle('var(--destructive-soft)', 'var(--destructive-ink)')} title={t('segments.detail.care.securityFlag', { defaultValue: 'Account-security signal: login differs from this member' })}>
                  <ShieldAlert size={11} aria-hidden /> {t('segments.detail.care.security', { defaultValue: 'Security' })}
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-muted)' }}>
                {t('segments.detail.care.msgCount', { defaultValue: '{{n}} msg', n: tk.messages.length })}
              </span>
            </div>

            {tk.labels.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: snippet ? 6 : 0 }}>
                {tk.labels.map((l, i) => (
                  <span key={`${l.name ?? l.category ?? i}`} style={badgeStyle('var(--muted-soft)', 'var(--muted-ink)')}>
                    {l.name ?? l.category}
                  </span>
                ))}
              </div>
            )}

            {snippet && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{snippet}</div>
            )}
          </div>
        );
      })}

      <Link
        to={`/segments/${segmentId}/members/${encodeURIComponent(uid)}/care`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--brand)',
          textDecoration: 'none',
          marginTop: 2,
        }}
      >
        {t('segments.detail.care.viewFull', { defaultValue: 'View full care history' })}
        <ArrowUpRight size={14} aria-hidden />
      </Link>
    </div>
  );
}
