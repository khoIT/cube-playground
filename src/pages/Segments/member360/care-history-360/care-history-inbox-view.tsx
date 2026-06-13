/**
 * Inbox view (Variant A): ticket list + selected-ticket transcript + signals
 * rail. Three panes on wide screens, collapsing to a single column on narrow
 * ones (see care-history-360.module.css).
 */

import { ReactElement } from 'react';
import type { CsTicketDetail } from '../../../../api/segment-cs-care-member';
import { CareHistoryTicketList } from './care-history-ticket-list';
import { CareHistoryTranscript } from './care-history-transcript';
import { CareHistorySignals } from './care-history-signals';
import styles from './care-history-360.module.css';

interface Props {
  tickets: CsTicketDetail[];
  selectedId: string;
  onSelect: (ticketId: string) => void;
}

export function CareHistoryInboxView({ tickets, selectedId, onSelect }: Props): ReactElement {
  const selected = tickets.find((t) => t.ticketId === selectedId) ?? tickets[0];
  return (
    <div className={styles.inbox}>
      <div className={styles.inboxList}>
        <CareHistoryTicketList tickets={tickets} selectedId={selected?.ticketId ?? ''} onSelect={onSelect} />
      </div>
      <div className={styles.inboxMain}>
        {selected && (
          <>
            <div style={{ padding: '11px 18px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>TIC-{selected.ticketId}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {selected.source}
                {selected.staffDomain ? ` · ${selected.staffDomain}` : ''}
              </span>
            </div>
            <CareHistoryTranscript ticket={selected} />
          </>
        )}
      </div>
      <div className={styles.inboxRail}>{selected && <CareHistorySignals ticket={selected} />}</div>
    </div>
  );
}
