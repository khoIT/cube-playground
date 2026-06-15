/**
 * Transcript pane for one CS ticket: player↔staff chat bubbles (side by
 * is_customer), attachment chips, reopen/session dividers, a truncation note,
 * then a footer with the verbatim rating + structured complaint tags. Content is
 * already HTML-stripped plain text server-side — rendered as text, never
 * dangerouslySetInnerHTML.
 *
 * Sender attribution is structural, since the warehouse carries no per-message
 * automated flag (canned greetings share the assigned agent's sender_id): a staff
 * message that appears BEFORE the first customer message is the system's ticket-
 * open greeting ("Auto-reply"); all other staff messages are agent-sent. For
 * Form tickets (auto-close on), each customer message that follows a staff
 * message reopens the ticket — we mark those as session boundaries.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CsTicketDetail, CsTicketMessage } from '../../../../api/segment-cs-care-member';
import { Stars } from '../../detail/tabs/care/care-ui-atoms';
import { InfoTip } from './care-history-info-tip';
import { fmtMsgTime } from './care-history-format';
import { CareHistoryAttachment } from './care-history-attachment';

function ReopenDivider({ at }: { at: string | null }): ReactElement {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border-card)' }} />
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {t('segments.detail.care.reopened', { defaultValue: 'Reopened' })}
        {at ? ` · ${fmtMsgTime(at)}` : ''}
        <InfoTip
          width={260}
          text={t('segments.detail.care.reopenedHint', {
            defaultValue: 'The ticket auto-closed and the player wrote again — a new session. Inferred from the ticket’s reopen count.',
          })}
        />
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border-card)' }} />
    </div>
  );
}

function Bubble({ m, auto, sender }: { m: CsTicketMessage; auto: boolean; sender: string }): ReactElement {
  const { t } = useTranslation();
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
          background: mine ? 'var(--brand)' : auto ? 'transparent' : 'var(--neutral-100)',
          color: mine ? 'var(--text-on-brand)' : auto ? 'var(--text-secondary)' : 'var(--text-primary)',
          border: auto ? '1px dashed var(--border-card)' : 'none',
          borderBottomRightRadius: mine ? 4 : 14,
          borderBottomLeftRadius: mine ? 14 : 4,
        }}
      >
        {m.text || '—'}
        {m.attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6, marginTop: 6 }}>
            {m.attachments.map((a, i) => (
              <CareHistoryAttachment key={`${a}-${i}`} raw={a} mine={mine} />
            ))}
          </div>
        )}
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', margin: '2px 4px 0', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {auto ? (
          <>
            <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{t('segments.detail.care.autoReply', { defaultValue: 'Auto-reply' })}</span>
            <InfoTip
              width={260}
              text={t('segments.detail.care.autoReplyHint', {
                defaultValue: 'System-sent greeting when the ticket opens. Templated under the assigned agent — not typed live by them.',
              })}
            />
            <span>·</span>
          </>
        ) : (
          sender && <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{sender} ·</span>
        )}
        {fmtMsgTime(m.at)}
      </span>
    </div>
  );
}

export function CareHistoryTranscript({ ticket }: { ticket: CsTicketDetail }): ReactElement {
  const { t } = useTranslation();
  const msgs = ticket.messages;
  const firstCustomerIdx = msgs.findIndex((m) => m.isCustomer);
  // Reopen/session dividers only where the auto-close→reply mapping holds (Form
  // tickets with at least one recorded reopen); capped at reopenCount so a chatty
  // thread never sprouts more dividers than the master row attests.
  const reopenEligible = ticket.serviceType === 'Form' && ticket.reopenCount > 0;
  const playerLabel = t('segments.detail.care.player', { defaultValue: 'Player' });
  const agentLabel = ticket.staffDomain ?? t('segments.detail.care.csAgent', { defaultValue: 'CS agent' });

  let dividersShown = 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px', overflow: 'auto', flex: 1 }}>
        {ticket.messagesTruncated && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            {t('segments.detail.care.msgTruncated', { defaultValue: 'Showing the most recent messages only.' })}
          </div>
        )}
        {msgs.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
            {t('segments.detail.care.noMessages', { defaultValue: 'No message content on this ticket.' })}
          </div>
        ) : (
          msgs.map((m, i) => {
            // Auto-greeting: a staff message before the player ever wrote.
            const auto = !m.isCustomer && (firstCustomerIdx === -1 || i < firstCustomerIdx);
            // Session boundary: a player message that follows a staff message
            // (re-engagement after an auto-close) — never the opening message.
            const isBoundary =
              reopenEligible &&
              m.isCustomer &&
              i !== firstCustomerIdx &&
              i > 0 &&
              !msgs[i - 1].isCustomer &&
              dividersShown < ticket.reopenCount;
            if (isBoundary) dividersShown += 1;
            const sender = m.isCustomer ? playerLabel : agentLabel;
            return (
              <div key={i} style={{ display: 'contents' }}>
                {isBoundary && <ReopenDivider at={m.at} />}
                <Bubble m={m} auto={auto} sender={sender} />
              </div>
            );
          })
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
