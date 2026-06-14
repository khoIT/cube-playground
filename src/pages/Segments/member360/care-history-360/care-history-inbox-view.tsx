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
import { CareHistoryTicketInfo } from './care-history-ticket-info';
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
            <CareHistoryTicketInfo ticket={selected} />
            <CareHistoryTranscript ticket={selected} />
          </>
        )}
      </div>
      <div className={styles.inboxRail}>{selected && <CareHistorySignals ticket={selected} />}</div>
    </div>
  );
}
