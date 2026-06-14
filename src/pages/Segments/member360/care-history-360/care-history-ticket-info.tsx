/**
 * Ticket-info header for the selected CS ticket — the "what happened" envelope
 * above the transcript: ticket id, status, security/reopen flags, the issue
 * classification, and a meta line of lifecycle facts (opened / closed / time to
 * resolve / first reply / channel / handler). Token-only, mirrors the Signals rail
 * styling so the two read as one surface.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import type { CsTicketDetail } from '../../../../api/segment-cs-care-member';
import { Chip, statusTone } from '../../detail/tabs/care/care-ui-atoms';
import { fmtDateTime, fmtDuration, fmtLatency, ticketTitle } from './care-history-format';

function Meta({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <span>
      <span style={{ color: 'var(--text-muted)' }}>{label} </span>
      <span style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </span>
  );
}

export function CareHistoryTicketInfo({ ticket }: { ticket: CsTicketDetail }): ReactElement {
  const { t } = useTranslation();
  const issue = ticket.ticketCategory ?? ticket.formName ?? ticketTitle(ticket.labels);
  const resolved = fmtDuration(ticket.createdAt ?? null, ticket.closedAt);

  return (
    <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-card)', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>TIC-{ticket.ticketId}</span>
        {ticket.status && <Chip tone={statusTone(ticket.status)}>{ticket.status}</Chip>}
        {ticket.reopenCount > 0 && (
          <Chip tone="warn">{t('segments.detail.care.reopensN', { defaultValue: '{{n}}× reopened', n: ticket.reopenCount })}</Chip>
        )}
        {ticket.securityFlag && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: 'var(--destructive-ink)' }}>
            <ShieldAlert size={12} aria-hidden /> {t('segments.detail.care.securityFlag', { defaultValue: 'Account security' })}
          </span>
        )}
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>{issue}</div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11.5 }}>
        <Meta label={t('segments.detail.care.opened', { defaultValue: 'Opened' })} value={fmtDateTime(ticket.createdAt ?? ticket.openedAt)} />
        <Meta
          label={t('segments.detail.care.closed', { defaultValue: 'Closed' })}
          value={ticket.closedAt ? fmtDateTime(ticket.closedAt) : t('segments.detail.care.stillOpen', { defaultValue: 'Open' })}
        />
        {resolved && <Meta label={t('segments.detail.care.resolvedIn', { defaultValue: 'Resolved in' })} value={resolved} />}
        <Meta label={t('segments.detail.care.firstReply', { defaultValue: 'First reply' })} value={fmtLatency(ticket.latencyMin)} />
        <Meta label={t('segments.detail.care.col.channel', { defaultValue: 'Channel' })} value={ticket.source || '—'} />
        <Meta label={t('segments.detail.care.handler', { defaultValue: 'Handler' })} value={ticket.staffDomain ?? ticket.staffDept ?? '—'} />
      </div>
    </div>
  );
}
