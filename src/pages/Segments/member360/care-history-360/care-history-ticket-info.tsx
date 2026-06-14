/**
 * Ticket-info header for the selected CS ticket — the "what happened" envelope
 * above the transcript: ticket id, status, security/reopen flags, the issue
 * classification, and a compact meta line of lifecycle facts (opened / time to
 * resolve / first reply / channel / handler). Token-only, mirrors the Signals rail
 * styling so the two read as one surface.
 *
 * The title block is a single breadcrumb row — `form_group › form_name` — which
 * makes the two form labels' roles explicit: the group is the support area the
 * player chose, the name is the specific request form they submitted. An InfoTip
 * (instant, token-styled) carries the explanation; we avoid the native `title`
 * attribute, which forces a `help` (?) cursor and a ~1s OS show delay.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, FileText, ChevronRight } from 'lucide-react';
import type { CsTicketDetail } from '../../../../api/segment-cs-care-member';
import { Chip, statusTone } from '../../detail/tabs/care/care-ui-atoms';
import { InfoTip } from './care-history-info-tip';
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
  const isForm = ticket.serviceType === 'Form';
  // For form tickets the form the player submitted is the headline; the group is
  // the support area (breadcrumb). Non-form tickets fall back to the issue label.
  const title = isForm
    ? ticket.formName ?? ticket.ticketCategory ?? ticketTitle(ticket.labels)
    : ticket.ticketCategory ?? ticket.formName ?? ticketTitle(ticket.labels);
  const category = ticket.formGroup;
  const resolved = fmtDuration(ticket.createdAt ?? null, ticket.closedAt);

  const formHint = category
    ? t('segments.detail.care.formRolesHint', {
        defaultValue:
          '“{{category}}” is the support area the player chose; “{{form}}” is the specific request form they submitted. The thread opens with an automated greeting — the player’s own typed message follows.',
        category,
        form: title,
      })
    : t('segments.detail.care.formInitiatedHint', {
        defaultValue:
          'Raised via web form — the title is the form the player submitted. The thread opens with an automated greeting; the player’s own typed message follows.',
      });

  return (
    <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-card)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Identity + status */}
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

      {/* Title breadcrumb: support area › request form (+ Form-initiated marker) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {category && (
          <>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{category}</span>
            <ChevronRight size={13} aria-hidden style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          </>
        )}
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>{title}</span>
        {isForm && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--info-ink)',
                background: 'var(--info-soft)',
                borderRadius: 'var(--radius-full)',
                padding: '1px 8px',
              }}
            >
              <FileText size={10} aria-hidden /> {t('segments.detail.care.formInitiated', { defaultValue: 'Form' })}
            </span>
            <InfoTip text={formHint} width={300} />
          </span>
        )}
      </div>

      {/* Lifecycle meta — single line */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11.5 }}>
        <Meta label={t('segments.detail.care.opened', { defaultValue: 'Opened' })} value={fmtDateTime(ticket.createdAt ?? ticket.openedAt)} />
        {resolved && <Meta label={t('segments.detail.care.resolvedIn', { defaultValue: 'Resolved in' })} value={resolved} />}
        <Meta label={t('segments.detail.care.firstReply', { defaultValue: 'First reply' })} value={fmtLatency(ticket.latencyMin)} />
        <Meta label={t('segments.detail.care.col.channel', { defaultValue: 'Channel' })} value={ticket.source || '—'} />
        <Meta label={t('segments.detail.care.handler', { defaultValue: 'Handler' })} value={ticket.staffDomain ?? ticket.staffDept ?? '—'} />
      </div>
    </div>
  );
}
