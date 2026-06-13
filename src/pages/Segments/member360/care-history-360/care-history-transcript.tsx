/**
 * Transcript pane for one CS ticket: player↔staff chat bubbles (side by
 * is_customer), attachment chips, a truncation note, then a footer with the
 * verbatim rating + structured complaint tags. Content is already HTML-stripped
 * plain text server-side — rendered as text, never dangerouslySetInnerHTML.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import type { CsTicketDetail, CsTicketMessage } from '../../../../api/segment-cs-care-member';
import { Stars } from '../../detail/tabs/care/care-ui-atoms';
import { fmtMsgTime } from './care-history-format';

function Bubble({ m }: { m: CsTicketMessage }): ReactElement {
  const mine = m.isCustomer;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '76%',
          padding: '9px 13px',
          borderRadius: 14,
          fontSize: 12.5,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: mine ? 'var(--brand)' : 'var(--neutral-100)',
          color: mine ? '#fff' : 'var(--text-primary)',
          borderBottomRightRadius: mine ? 4 : 14,
          borderBottomLeftRadius: mine ? 14 : 4,
        }}
      >
        {m.text || '—'}
        {m.attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
            {m.attachments.map((a) => (
              <span
                key={a}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 10,
                  background: mine ? 'rgba(255,255,255,0.2)' : 'var(--bg-muted)',
                  color: mine ? '#fff' : 'var(--text-secondary)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '1px 6px',
                }}
                title={a}
              >
                <Paperclip size={10} aria-hidden /> {a.split('/').pop()}
              </span>
            ))}
          </div>
        )}
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', margin: '2px 4px 0' }}>{fmtMsgTime(m.at)}</span>
    </div>
  );
}

export function CareHistoryTranscript({ ticket }: { ticket: CsTicketDetail }): ReactElement {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px', overflow: 'auto', flex: 1 }}>
        {ticket.messagesTruncated && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            {t('segments.detail.care.msgTruncated', { defaultValue: 'Showing the most recent messages only.' })}
          </div>
        )}
        {ticket.messages.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
            {t('segments.detail.care.noMessages', { defaultValue: 'No message content on this ticket.' })}
          </div>
        ) : (
          ticket.messages.map((m, i) => <Bubble key={i} m={m} />)
        )}
      </div>
      {ticket.rating && (ticket.rating.rating != null || ticket.rating.feedback) && (
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-card)', background: 'var(--neutral-50)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Stars rating={ticket.rating.rating} />
            {ticket.rating.feedback && (
              <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--text-secondary)' }}>“{ticket.rating.feedback}”</span>
            )}
          </div>
          {ticket.rating.feedbackOptions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
              {ticket.rating.feedbackOptions.map((o) => (
                <span key={o} style={{ fontSize: 10, background: 'var(--bg-muted)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', padding: '1px 6px' }}>
                  {o}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
