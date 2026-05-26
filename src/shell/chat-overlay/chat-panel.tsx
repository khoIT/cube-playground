/**
 * ChatPanel — right-docked flex-sibling aside that pushes main content.
 * NOT position:fixed — width participates in the shell flex layout.
 *
 * Drag-resize: 6px bar on left edge uses pointer capture so cleanup is
 * automatic; width persisted to localStorage on pointerUp only.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import { T } from '../theme';
import { getWidth, setWidth } from './chat-panel-open-store';
import { useActiveChatSession, setActiveChatSession } from './use-active-chat-session';
import { notifyChatSessionChanged } from './chat-session-events';
import { ChatPanelHeader } from './chat-panel-header';
import { ChatPanelEmptyState } from './chat-panel-empty-state';
import { ChatThreadView } from '../../pages/Chat/components/chat-thread-view';
import { ChatComposer } from '../../pages/Chat/components/chat-composer';
import { usePanelChatState } from './use-panel-chat-state';
import { clearSessionModeOverride } from './use-session-mode-override';
import { useCancelTurn } from '../../pages/Chat/hooks/use-cancel-turn';
import { TurnCancelButton } from '../../pages/Chat/components/turn-cancel-button';

const WIDTH_MIN = 360;
const WIDTH_MAX = 720;

interface ChatPanelProps {
  onClose: () => void;
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const history = useHistory();
  const [sessionId, setSessionId] = useActiveChatSession();
  const panelRef = useRef<HTMLElement>(null);

  const {
    displayMessages,
    isStreaming,
    composerValue,
    setComposerValue,
    handleSubmit,
    cancel,
    resetChat,
    status,
    liveSessionId,
    liveTurnId,
  } = usePanelChatState(sessionId);

  // Phase 04 — server-side cancel for the panel's in-flight turn.
  const { cancel: cancelTurnRemote, busy: cancelBusy } = useCancelTurn({
    turnId: liveTurnId,
    cancelLocal: cancel,
  });

  // When stream creates a new session id, store it as the active session.
  useEffect(() => {
    if (liveSessionId && liveSessionId !== sessionId) {
      setSessionId(liveSessionId);
      setActiveChatSession(liveSessionId);
    }
  }, [liveSessionId, sessionId, setSessionId]);

  // On turn done, broadcast change so the sidebar + history rail refetch
  // their server-truth session lists. (Sidebar chat tray no longer uses
  // localStorage recents — see SidebarChatRecents.)
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current !== 'done' && status === 'done') {
      const sid = liveSessionId ?? sessionId;
      if (sid) notifyChatSessionChanged(sid);
    }
    prevStatusRef.current = status;
  }, [status, liveSessionId, sessionId]);

  // ---------------------------------------------------------------------------
  // Drag-resize (pointer capture)
  // ---------------------------------------------------------------------------

  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const onDragPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragStartX.current = e.clientX;
    // offsetWidth is 0 when the element has no CSS layout (SSR/test env);
    // fall back to the persisted store width in that case.
    dragStartWidth.current = panelRef.current?.offsetWidth || getWidth();
  }, []);

  const onDragPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.buttons) return;
    const delta = dragStartX.current - e.clientX; // dragging left = wider
    const next = Math.min(Math.max(dragStartWidth.current + delta, WIDTH_MIN), WIDTH_MAX);
    if (panelRef.current) panelRef.current.style.width = `${next}px`;
  }, []);

  const onDragPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const delta = dragStartX.current - e.clientX;
    const next = Math.min(Math.max(dragStartWidth.current + delta, WIDTH_MIN), WIDTH_MAX);
    setWidth(next);
    if (panelRef.current) panelRef.current.style.width = `${next}px`;
  }, []);

  // ---------------------------------------------------------------------------
  // Header actions
  // ---------------------------------------------------------------------------

  const handleNew = useCallback(() => {
    // resetChat does cancel() + wipes committedMessages/composer/firstUserMessage.
    // Must run regardless of whether sessionId is already null (e.g. user
    // submitted then clicked + before session_created arrived).
    clearSessionModeOverride(sessionId);
    resetChat();
    setSessionId(null);
    setActiveChatSession(null);
  }, [resetChat, setSessionId, sessionId]);

  const handleExpand = useCallback(() => {
    const target = sessionId ? `/chat/${sessionId}` : '/chat';
    history.push(target);
  }, [sessionId, history]);

  const isEmpty = displayMessages.length === 0 && !isStreaming;

  return (
    <aside
      ref={panelRef}
      data-testid="chat-panel"
      style={{
        width: getWidth(),
        flexShrink: 0,
        height: '100%',
        background: T.sidebar,
        borderLeft: `1px solid ${T.n200}`,
        borderRadius: 18,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Drag handle — 6px left edge */}
      <div
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        data-testid="chat-panel-drag-handle"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 10,
        }}
      />

      <ChatPanelHeader
        sessionId={sessionId}
        onClose={onClose}
        onNew={handleNew}
        onExpand={handleExpand}
      />

      {isEmpty ? (
        <>
          <ChatPanelEmptyState onSuggest={setComposerValue} />
          <ChatComposer
            value={composerValue}
            onChange={setComposerValue}
            onSubmit={handleSubmit}
            disabled={isStreaming}
            compact
          />
        </>
      ) : (
        <>
          <ChatThreadView
            messages={displayMessages}
            streaming={isStreaming}
            composerValue={composerValue}
            onComposerChange={setComposerValue}
            onSubmit={handleSubmit}
            compact
          />
          {/* Phase 04 — Stop generating affordance in the side panel. */}
          {isStreaming && liveTurnId && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '4px 0 12px',
              }}
            >
              <TurnCancelButton
                turnId={liveTurnId}
                isStreaming={isStreaming}
                onCancel={cancelTurnRemote}
                busy={cancelBusy}
              />
            </div>
          )}
        </>
      )}
    </aside>
  );
}
