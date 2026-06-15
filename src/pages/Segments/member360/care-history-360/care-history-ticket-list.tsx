/**
 * Ticket list for the inbox view — one selectable row per ticket with date,
 * title, sentiment/status chips, stars, reopen badge, and a security marker.
 * The selected row gets a brand left-border + tint.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, RotateCcw } from 'lucide-react';
import type { CsTicketDetail } from '../../../../api/segment-cs-care-member';
import { Chip, Stars, sentimentTone, statusTone } from '../../detail/tabs/care/care-ui-atoms';
import { ticketTitle } from './care-history-format';

interface Props {
  tickets: CsTicketDetail[];
  selectedId: string;
  onSelect: (ticketId: string) => void;
}

export function CareHistoryTicketList({ tickets, selectedId, onSelect }: Props): ReactElement {
  const { t } = useTranslation();
  return (
    <div>
      <div style={{ padding: '12px 16px', background: 'var(--surface-inset)', borderBottom: '1px solid var(--border-card)', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
        {t('segments.detail.care.ticketCount', { defaultValue: '{{n}} tickets · 365d', n: tickets.length })}
      </div>
      {tickets.map((tk) => {
        const sel = tk.ticketId === selectedId;
        return (
          <button
            key={tk.ticketId}
            type="button"
            onClick={() => onSelect(tk.ticketId)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '12px 16px',
              border: 'none',
              borderBottom: '1px solid var(--border-card)',
              borderLeft: sel ? '3px solid var(--brand)' : '3px solid transparent',
              background: sel ? 'var(--orange-50)' : 'transparent',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{tk.openedAt}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {tk.securityFlag && <ShieldAlert size={12} color="var(--destructive-ink)" aria-label="security" />}
                {tk.reopenCount > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 600, color: 'var(--warning-ink)' }}>
                    <RotateCcw size={10} aria-hidden /> {tk.reopenCount}×
                  </span>
                )}
              </span>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, margin: '4px 0 5px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ticketTitle(tk.labels)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {tk.sentiment.last && <Chip tone={sentimentTone(tk.sentiment.last)}>{tk.sentiment.last}</Chip>}
              <Stars rating={tk.rating?.rating ?? null} />
              {tk.status && <Chip tone={statusTone(tk.status)}>{tk.status}</Chip>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
