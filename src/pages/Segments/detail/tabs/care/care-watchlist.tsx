/**
 * Risk watchlist — the hero of the Care tab. Contacted whales sorted by risk
 * score (negative sentiment + low rating + open status + high-stakes category +
 * LTV rank), each row drilling to the member-360 view. The actionable "who do
 * I call first" list for a CS / VIP-care lead.
 */

import { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CsCareWatchlistEntry } from '../../../../../api/segment-cs-care';
import { Chip, Stars, fmtVnd, sentimentTone, statusTone } from './care-ui-atoms';

interface Props {
  segmentId: string;
  rows: CsCareWatchlistEntry[];
}

const COLS = '1.6fr 92px 1fr 70px 96px 64px 100px 56px';

function HeadCell({ children, right }: { children: string; right?: boolean }): ReactElement {
  return <span style={{ textAlign: right ? 'right' : 'left' }}>{children}</span>;
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
          background: 'var(--neutral-50)',
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
        <Link
          key={r.uid}
          to={`/segments/${segmentId}/members/${encodeURIComponent(r.uid)}`}
          style={{
            display: 'grid',
            gridTemplateColumns: COLS,
            alignItems: 'center',
            gap: 12,
            padding: '11px 18px',
            borderBottom: '1px solid var(--border-card)',
            fontSize: 12.5,
            color: 'inherit',
            textDecoration: 'none',
          }}
        >
          <span style={{ overflow: 'hidden' }}>
            <span style={{ fontWeight: 600, color: 'var(--brand)' }}>{r.name ?? r.uid}</span>
            {r.name && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.uid}
              </div>
            )}
          </span>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtVnd(r.ltv)}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{r.lastCategory ?? '—'}</span>
          <span style={{ color: 'var(--text-muted)' }}>{r.lastSource || '—'}</span>
          <span>{r.sentiment ? <Chip tone={sentimentTone(r.sentiment)}>{r.sentiment}</Chip> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
          <span><Stars rating={r.rating} /></span>
          <span>{r.statusGroup ? <Chip tone={statusTone(r.statusGroup)}>{r.statusGroup}</Chip> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7 }}>
            <span style={{ width: 30, height: 5, borderRadius: 3, background: 'var(--neutral-200)', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.min(100, r.riskScore)}%`, background: 'var(--brand)' }} />
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{r.riskScore}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
