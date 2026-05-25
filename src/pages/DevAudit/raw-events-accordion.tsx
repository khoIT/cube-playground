/**
 * RawEventsAccordion — lazy-loaded, cursor-paginated SDK event list.
 * Events are NOT prefetched; the user must click "Load events" to trigger the first page.
 * Subsequent pages appended via "Load more".
 */
import React, { useState } from 'react';
import { T } from '../../shell/theme';
import { useDebugRawEvents } from './use-debug-api';

interface RawEventsAccordionProps {
  turnId: string;
}

const styles = {
  root: {
    marginTop: 8,
    border: `1px solid ${T.n200}`,
    borderRadius: 6,
    overflow: 'hidden',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: T.surfaceMuted,
    cursor: 'pointer',
    userSelect: 'none' as const,
    fontSize: 12,
    fontWeight: 600,
    color: T.n600,
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
    borderBottom: `1px solid ${T.n100}`,
    fontSize: 11,
    fontFamily: T.fMono,
    alignItems: 'start',
  } as React.CSSProperties,
  seqCell: { color: T.n400, textAlign: 'right' as const },
  typeCell: { color: T.brand, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  payloadCell: {
    color: T.n700,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    maxHeight: 120,
    overflow: 'hidden',
  } as React.CSSProperties,
  btn: {
    display: 'inline-block',
    marginTop: 8,
    padding: '4px 10px',
    background: T.surfaceSubtle,
    border: `1px solid ${T.n300}`,
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
    color: T.n700,
  } as React.CSSProperties,
  err: { color: T.red500, fontSize: 11, padding: '4px 0' } as React.CSSProperties,
};

export function RawEventsAccordion({ turnId }: RawEventsAccordionProps) {
  const [open, setOpen] = useState(false);
  const [triggered, setTriggered] = useState(false);
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
        {events.length > 0 && <span style={{ color: T.n400, fontWeight: 400 }}>({events.length})</span>}
      </div>

      {open && (
        <div style={styles.body}>
          {events.length === 0 && isLoading && (
            <div style={{ color: T.n400, fontSize: 11 }}>Loading events…</div>
          )}
          {events.length === 0 && !isLoading && !error && (
            <div style={{ color: T.n400, fontSize: 11 }}>No events recorded.</div>
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
            <div style={{ color: T.n400, fontSize: 11, marginTop: 4 }}>Loading…</div>
          )}
        </div>
      )}
    </div>
  );
}
