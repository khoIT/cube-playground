/**
 * Signals rail for the selected ticket — the at-a-glance "why this matters"
 * column: sentiment trajectory, reopens, first-response latency, channel,
 * handler, hashtags, and the AI-label chips. Reuses the Care chips/tones.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CsTicketDetail } from '../../../../api/segment-cs-care-member';
import { Chip, sentimentTone } from '../../detail/tabs/care/care-ui-atoms';
import { fmtLatency } from './care-history-format';

function Row({ label, children }: { label: string; children: React.ReactNode }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>{children}</span>
    </div>
  );
}

export function CareHistorySignals({ ticket }: { ticket: CsTicketDetail }): ReactElement {
  const { t } = useTranslation();
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>
        {t('segments.detail.care.signals', { defaultValue: 'Signals' })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 12 }}>
        <Row label={t('segments.detail.care.col.sentiment', { defaultValue: 'Sentiment' })}>
          {ticket.sentiment.first || ticket.sentiment.last ? (
            <span>
              {ticket.sentiment.first ?? '—'} → <b style={{ color: `var(--${sentimentTone(ticket.sentiment.last)}-ink)` }}>{ticket.sentiment.last ?? '—'}</b>
            </span>
          ) : (
            '—'
          )}
        </Row>
        <Row label={t('segments.detail.care.reopensLabel', { defaultValue: 'Reopens' })}>
          <b>{ticket.reopenCount}×</b>
        </Row>
        <Row label={t('segments.detail.care.firstReply', { defaultValue: 'First reply' })}>{fmtLatency(ticket.latencyMin)}</Row>
        <Row label={t('segments.detail.care.col.channel', { defaultValue: 'Channel' })}>{ticket.source || '—'}</Row>
        <Row label={t('segments.detail.care.handler', { defaultValue: 'Handler' })}>
          {ticket.staffDomain ?? ticket.staffDept ?? '—'}
        </Row>
        {ticket.tags.length > 0 && (
          <Row label={t('segments.detail.care.hashtag', { defaultValue: 'Hashtag' })}>{ticket.tags.join(', ')}</Row>
        )}
      </div>
      {ticket.labels.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
            {t('segments.detail.care.aiLabels', { defaultValue: 'AI labels' })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {ticket.labels.map((l, i) => (
              <Chip key={i} tone="neu">{l.name ?? l.category ?? '—'}</Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
