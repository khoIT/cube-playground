/**
 * RawEventsAccordion — lazy-loaded, cursor-paginated SDK event list.
 * Events are NOT prefetched; the user must click "Load events" to trigger the first page.
 * Subsequent pages appended via "Load more".
 */
import React, { useState } from 'react';
import { T } from '../../shell/theme';
import { useDebugRawEvents } from './use-debug-api';
import { readChatServiceSettings } from '../Settings/ChatService/use-chat-service-settings';

interface RawEventsAccordionProps {
  turnId: string;
}

const styles = {
  root: {
    marginTop: 8,
    border: `1px solid var(--shell-border)`,
    borderRadius: 6,
    overflow: 'hidden',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: 'var(--surface-muted)',
    cursor: 'pointer',
    userSelect: 'none' as const,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--shell-text-muted)',
  } as React.CSSProperties,
  body: {
    padding: '8px 12px',
    maxHeight: 400,
    overflowY: 'auto' as const,
  } as React.CSSProperties,
  row: {
    display: 'grid',
    gridTemplateColumns: '40px 140px 1fr',
    gap: 8,
    padding: '3px 0',
    borderBottom: `1px solid var(--shell-bg-subtle)`,
    fontSize: 11,
    fontFamily: T.fMono,
    alignItems: 'start',
  } as React.CSSProperties,
  seqCell: { color: 'var(--shell-text-faint)', textAlign: 'right' as const },
  typeCell: { color: 'var(--shell-brand)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  payloadCell: {
    color: 'var(--shell-text-secondary)',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    maxHeight: 120,
    overflow: 'hidden',
  } as React.CSSProperties,
  btn: {
    display: 'inline-block',
    marginTop: 8,
    padding: '4px 10px',
    background: 'var(--surface-subtle)',
    border: `1px solid var(--shell-border-strong)`,
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
    color: 'var(--shell-text-secondary)',
  } as React.CSSProperties,
  err: { color: 'var(--shell-danger)', fontSize: 11, padding: '4px 0' } as React.CSSProperties,
};

export function RawEventsAccordion({ turnId }: RawEventsAccordionProps) {
  // Read initial expanded state from settings (non-hook, avoids re-render overhead).
  const defaultExpanded = readChatServiceSettings().rawEventsDefaultExpanded;
  const [open, setOpen] = useState(defaultExpanded);
  const [triggered, setTriggered] = useState(defaultExpanded);
  const { events, hasMore, isLoading, error, loadMore } = useDebugRawEvents(open ? turnId : null);

  function handleOpen() {
    setOpen((v) => !v);
    if (!triggered) {
      setTriggered(true);
      // loadMore fires after turnId becomes non-null on next render via effect
    }
  }

  // When we open for the first time and have no events yet, kick off load
  React.useEffect(() => {
    if (open && triggered && events.length === 0 && !isLoading && !error) {
      loadMore();
    }
  }, [open, triggered]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={styles.root}>
      <div style={styles.header} onClick={handleOpen} role="button" aria-expanded={open}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 150ms' }}>▶</span>
        Raw SDK Events
        {events.length > 0 && <span style={{ color: 'var(--shell-text-faint)', fontWeight: 400 }}>({events.length})</span>}
      </div>

      {open && (
        <div style={styles.body}>
          {events.length === 0 && isLoading && (
            <div style={{ color: 'var(--shell-text-faint)', fontSize: 11 }}>Loading events…</div>
          )}
          {events.length === 0 && !isLoading && !error && (
            <div style={{ color: 'var(--shell-text-faint)', fontSize: 11 }}>No events recorded.</div>
          )}
          {error && <div style={styles.err}>Error: {error}</div>}

          {events.map((ev) => (
            <div key={ev.id} style={styles.row}>
              <span style={styles.seqCell}>{ev.seq}</span>
              <span style={styles.typeCell}>{ev.type}</span>
              <span style={styles.payloadCell}>
                {ev.payload_json
                  ? (() => { try { return JSON.stringify(JSON.parse(ev.payload_json), null, 2); } catch { return ev.payload_json; } })()
                  : '—'}
              </span>
            </div>
          ))}

          {hasMore && !isLoading && (
            <button style={styles.btn} onClick={loadMore}>Load more</button>
          )}
          {isLoading && events.length > 0 && (
            <div style={{ color: 'var(--shell-text-faint)', fontSize: 11, marginTop: 4 }}>Loading…</div>
          )}
        </div>
      )}
    </div>
  );
}
