/**
 * Timeline view (Variant C): a chronological vertical spine, newest first, one
 * sentiment-colored node per ticket. Clicking a node expands its transcript
 * inline beneath the node header. The currently selected ticket starts expanded.
 */

import { ReactElement } from 'react';
import { ShieldAlert, RotateCcw } from 'lucide-react';
import type { CsTicketDetail } from '../../../../api/segment-cs-care-member';
import { Chip, Stars, sentimentTone } from '../../detail/tabs/care/care-ui-atoms';
import { CareHistoryTranscript } from './care-history-transcript';
import { ticketTitle } from './care-history-format';

interface Props {
  tickets: CsTicketDetail[];
  selectedId: string;
  onSelect: (ticketId: string) => void;
}

function dotColor(sentiment: string | null): string {
  if (sentiment === 'Negative') return 'var(--destructive-ink)';
  if (sentiment === 'Positive') return 'var(--success-ink)';
  return 'var(--neutral-400)';
}

export function CareHistoryTimelineView({ tickets, selectedId, onSelect }: Props): ReactElement {
  const ordered = [...tickets].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  return (
    <div
      style={{
        position: 'relative',
        paddingLeft: 26,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px 20px 46px',
      }}
    >
      <div style={{ position: 'absolute', left: 26, top: 24, bottom: 24, width: 2, background: 'var(--neutral-200)' }} />
      {ordered.map((tk) => {
        const open = tk.ticketId === selectedId;
        return (
          <div key={tk.ticketId} style={{ position: 'relative', marginBottom: 22 }}>
            <span
              style={{
                position: 'absolute',
                left: -26,
                top: 3,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: dotColor(tk.sentiment.last),
                border: '2px solid var(--bg-card)',
                boxShadow: `0 0 0 1px ${dotColor(tk.sentiment.last)}`,
              }}
            />
            <button
              type="button"
              onClick={() => onSelect(tk.ticketId)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontFamily: 'var(--font-sans)',
              }}
            >
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{tk.openedAt}</span>
              {tk.sentiment.last && <Chip tone={sentimentTone(tk.sentiment.last)}>{tk.sentiment.last}</Chip>}
              <Stars rating={tk.rating?.rating ?? null} />
              {tk.reopenCount > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10.5, fontWeight: 600, color: 'var(--warning-ink)' }}>
                  <RotateCcw size={11} aria-hidden /> {tk.reopenCount}×
                </span>
              )}
              {tk.securityFlag && <ShieldAlert size={13} color="var(--destructive-ink)" aria-label="security" />}
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{ticketTitle(tk.labels)}</span>
              {!open && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{tk.messages.length} msg · ▸</span>}
            </button>
            {open && (
              <div style={{ marginTop: 8, border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <CareHistoryTranscript ticket={tk} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
