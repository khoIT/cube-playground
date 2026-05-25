/**
 * ChatSearchOverlay — portal-rendered chat conversation finder, opened
 * from the sidebar "See all… (N)" button. Server-side title search via
 * useChatSessionsList(query). Sessions grouped by calendar bucket
 * (Today / Yesterday / Last 7 days / Last 30 days / Older).
 *
 * Keyboard:
 *   ↑/↓ — move selection (skips bucket headers)
 *   ↵   — open selected session
 *   ⎋   — close overlay
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useHistory } from 'react-router-dom';
import { Search, Maximize2 } from 'lucide-react';
import { T, Icon } from '../../shell/theme';
import { useChatSessionsList } from '../../pages/Chat/hooks/use-chat-sessions-list';
import { groupSessions, formatTimeAgoLong } from './group-sessions';
import { closeChatSearch, useChatSearchOpen } from './chat-search-store';
import { ChatRowKebabMenu } from '../chat-recents/chat-row-kebab-menu';

const DEBOUNCE_MS = 200;

export function ChatSearchOverlay() {
  const open = useChatSearchOpen();
  if (!open) return null;
  return createPortal(<OverlayBody />, document.body);
}

function OverlayBody() {
  const history = useHistory();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  const { sessions, isLoading, error } = useChatSessionsList(debounced);

  // Flat list of selectable rows in render order (bucket headers excluded).
  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const flatSessions = useMemo(() => groups.flatMap((g) => g.sessions), [groups]);

  // Clamp selection whenever the result set changes.
  useEffect(() => {
    if (selectedIndex >= flatSessions.length) setSelectedIndex(0);
  }, [flatSessions.length, selectedIndex]);

  // Scroll the active row into view if needed.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${selectedIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  function openSession(id: string | undefined) {
    if (!id) return;
    closeChatSearch();
    history.push(`/chat/${id}`);
  }

  // If the user deletes the conversation they're currently viewing, bounce
  // back to /chat so the route doesn't 404 on the next render.
  function handleDeleted(deletedId: string) {
    const activeMatch = window.location.hash.match(/^#\/chat\/([^?]+)/);
    if (activeMatch?.[1] === deletedId) {
      history.push('/chat');
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeChatSearch();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatSessions.length) setSelectedIndex((i) => (i + 1) % flatSessions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatSessions.length) setSelectedIndex((i) => (i - 1 + flatSessions.length) % flatSessions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openSession(flatSessions[selectedIndex]?.id);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) closeChatSearch(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(15,15,15,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        role="dialog"
        aria-label="Search conversations"
        data-testid="chat-search-overlay"
        onKeyDown={onKeyDown}
        style={{
          width: 'min(720px, 92vw)', maxHeight: '70vh',
          background: T.sidebar, border: `1px solid ${T.n200}`, borderRadius: 16,
          boxShadow: '0 24px 56px rgba(0,0,0,0.22)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <SearchInput value={query} onChange={setQuery} inputRef={inputRef} />
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
          {error ? (
            <Empty label="Couldn't load conversations" />
          ) : isLoading && flatSessions.length === 0 ? (
            <Empty label="Loading…" />
          ) : flatSessions.length === 0 ? (
            <Empty label={debounced ? `No matches for "${debounced}"` : 'No conversations yet'} />
          ) : (
            <GroupedList
              groups={groups}
              selectedIndex={selectedIndex}
              onHoverIndex={setSelectedIndex}
              onPick={openSession}
              onDeleted={handleDeleted}
              flatStartIndex={0}
            />
          )}
        </div>
        <Footer />
      </div>
    </div>
  );
}

function SearchInput({
  value, onChange, inputRef,
}: {
  value: string; onChange: (v: string) => void; inputRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '16px 20px', borderBottom: `1px solid ${T.n200}`,
    }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search…"
        style={{
          flex: 1, border: 'none', outline: 'none', background: 'transparent',
          fontFamily: T.fSans, fontSize: 15, color: T.n900,
        }}
      />
      <Icon icon={Search} size={18} color={T.n500} />
    </div>
  );
}

function GroupedList({
  groups, selectedIndex, onHoverIndex, onPick, onDeleted, flatStartIndex,
}: {
  groups: ReturnType<typeof groupSessions>;
  selectedIndex: number;
  onHoverIndex: (i: number) => void;
  onPick: (id: string) => void;
  onDeleted: (id: string) => void;
  flatStartIndex: number;
}) {
  let cursor = flatStartIndex;
  return (
    <>
      {groups.map((g) => {
        const startIdx = cursor;
        cursor += g.sessions.length;
        return (
          <div key={g.key}>
            <div style={{
              padding: '14px 20px 6px', fontFamily: T.fSans, fontSize: 11,
              fontWeight: 600, letterSpacing: '0.06em', color: T.n500,
            }}>
              {g.label}
            </div>
            {g.sessions.map((s, i) => {
              const flatIndex = startIdx + i;
              const active = flatIndex === selectedIndex;
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={-1}
                  data-row-index={flatIndex}
                  data-testid={`chat-search-row-${s.id}`}
                  onMouseEnter={() => onHoverIndex(flatIndex)}
                  onClick={() => onPick(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onPick(s.id);
                    }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '12px 20px',
                    background: active ? T.surfaceSubtle : 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{
                    flex: 1, minWidth: 0, fontFamily: T.fSans, fontSize: 14, color: T.n900,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{s.title || 'Untitled'}</span>
                  <span style={{
                    flexShrink: 0, fontFamily: T.fSans, fontSize: 12, color: T.n500,
                  }}>{formatTimeAgoLong(s.updatedAt ?? s.createdAt)}</span>
                  {active && (
                    <ChatRowKebabMenu
                      sessionId={s.id}
                      sessionTitle={s.title}
                      onDeleted={onDeleted}
                      menuZIndex={10001}
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div style={{
      padding: '32px 20px', textAlign: 'center', color: T.n500,
      fontFamily: T.fSans, fontSize: 13,
    }}>
      {label}
    </div>
  );
}

function Footer() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px',
      borderTop: `1px solid ${T.n200}`, fontFamily: T.fSans, fontSize: 12, color: T.n500,
    }}>
      <Icon icon={Maximize2} size={14} color={T.n500} />
      <span style={{ flex: 1 }} />
      <FooterHint label="Navigate" keys={['↑', '↓']} />
      <FooterHint label="Open" keys={['↵']} />
      <FooterHint label="Close" keys={['esc']} />
    </div>
  );
}

function FooterHint({ label, keys }: { label: string; keys: string[] }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {label}
      {keys.map((k) => (
        <kbd key={k} style={{
          fontFamily: T.fMono, fontSize: 11, color: T.n700,
          border: `1px solid ${T.n200}`, borderRadius: 4, padding: '1px 6px', background: T.surface,
        }}>{k}</kbd>
      ))}
    </span>
  );
}
