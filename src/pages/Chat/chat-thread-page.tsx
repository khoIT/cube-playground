/**
 * ChatThreadPage — single route component for /chat and /chat/:id.
 *
 *   :id === undefined  → empty/new thread; centered hero composer until the
 *                        user submits, then the same component mounts the
 *                        thread view and continues streaming in place.
 *   :id === 'new'      → equivalent to undefined (legacy alias).
 *   :id === <uuid>     → load history via useChatSession, then stream
 *                        continued turns.
 *
 * On `session_created` the URL is `history.replace`d to `/chat/<id>` — because
 * a single Route matches both shapes, the component stays MOUNTED, so the user
 * message bubble and in-flight stream survive the URL change.
 *
 * The side panel (ChatPanel) renders the same chat backend through the same
 * hooks; they share history via the `/sessions/*` API. URL → active-session
 * sync (one-directional) keeps the panel in step with whichever session the
 * /chat route is showing.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory, useParams, Link } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { setActiveChatSession } from '../../shell/chat-overlay/use-active-chat-session';
import { ChatThreadView } from './components/chat-thread-view';
import { ChatComposer } from './components/chat-composer';
import { ChatEmptyHero } from './components/chat-empty-hero';
import {
  DisconnectBanner,
  RateLimitedBanner,
  ErrorBanner,
  CompactWarningChip,
} from './components/chat-thread-status-banners';
import { useChatSession } from './hooks/use-chat-session';
import { useChatStream } from './hooks/use-chat-stream';
import { useCancelTurn } from './hooks/use-cancel-turn';
import { useAutoReplayAttach } from './hooks/use-auto-replay-attach';
import type { ChatMessage } from './components/chat-message-list';
import type { AssistantSection } from './components/assistant-message';
import { readChatServiceSettings } from '../Settings/ChatService/use-chat-service-settings';
import { ChatModeChip } from '../../shell/chat-overlay/chat-mode-chip';
import { TurnCancelButton } from './components/turn-cancel-button';
import { ChatHeaderFocusChip } from './components/chat-header-focus-chip';
import { ChatShareButton } from './components/chat-share-button';
import { useSessionFocus } from './hooks/use-session-focus';


// ---------------------------------------------------------------------------
// Helper — convert persisted session turns → ChatMessage[]
// ---------------------------------------------------------------------------

export function sessionTurnsToMessages(
  turns: ReturnType<typeof useChatSession>['session'] extends null
    ? never
    : ReturnType<typeof useChatSession>['session']['turns'],
): ChatMessage[] {
  return turns.map((t, idx, arr) => {
    if (t.role === 'user') return { role: 'user', id: t.id, text: t.text, ts: t.createdAt };
    const sections: AssistantSection[] = [];
    // Section order matches buildStreamingSections so layout is stable across
    // live → persisted state: thinking (reasoning + tool chips) → answer text
    // → supporting evidence (artifacts + charts).
    if (t.reasoning) sections.push({ type: 'reasoning', text: t.reasoning });
    for (const tc of t.toolCalls ?? []) {
      sections.push({ type: 'tool_call', id: tc.id, name: tc.name, status: tc.ok ? 'ok' : 'error', ms: tc.ms, summary: tc.summary });
    }
    if (t.text) sections.push({ type: 'text', text: t.text });
    const embeddedChartIds = new Set<string>();
    for (const art of t.artifacts ?? []) {
      if (art.chart?.id) embeddedChartIds.add(art.chart.id);
      sections.push({ type: 'query_artifact', artifact: {
        id: art.id, title: art.title, summary: art.summary,
        deeplinkUrl: art.deeplinkUrl, deeplinkVia: art.deeplinkVia,
        source: art.source as 'business-metric' | 'segment' | 'raw',
        sourceRef: art.sourceRef, payload: art.payload, query: art.query,
        chart: art.chart,
      }});
    }
    for (const ch of t.charts ?? []) {
      if (embeddedChartIds.has(ch.id)) continue;
      sections.push({ type: 'chart', artifact: ch });
    }
    // The persisted choice-chip set, plus which option (if any) was already
    // picked — inferred from the following user turn whose text equals an
    // option's pinText (a chip click sends pinText verbatim as the next turn).
    const disambig = t.disambig ?? null;
    const nextTurn = arr[idx + 1];
    const disambigSelectedPinText =
      disambig && nextTurn?.role === 'user'
        ? disambig.options.find((o) => o.pinText === nextTurn.text)?.pinText ?? null
        : null;
    return {
      role: 'assistant',
      id: t.id,
      sections,
      ts: t.createdAt,
      cacheHit: t.cacheHit ?? false,
      cacheFreshness: t.cacheFreshness ?? null,
      disambigOptions: disambig,
      disambigSelectedPinText,
    };
  });
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function ChatThreadPage() {
  const { id } = useParams<{ id?: string }>();
  const history = useHistory();
  const gameId = useActiveGameId();
  const isNew = !id || id === 'new';
  const [composerValue, setComposerValue] = useState('');
  const [committedMessages, setCommittedMessages] = useState<ChatMessage[]>([]);
  /** Phase-06: bypass cache toggle — off by default; set per-send. */
  const [bypassCache, setBypassCache] = useState(false);
  /** Web search toggle — when ON sends X-Web-Search: 1 per turn (subject to env master flag). */
  const [webSearch, setWebSearch] = useState(false);
  /** Research mode toggle — when ON sends X-Research-Mode: 1 per turn (extended timeout). */
  const [researchMode, setResearchMode] = useState(false);
  const hydratedRef = useRef(false);

  const { session, isLoading, forbidden, refetch: refetchSession } = useChatSession(isNew ? null : id ?? null);

  // Refresh-resume (Phase 7): if the session has an in-flight turn on the
  // server, attach the replay stream so the view picks up partial output.
  useAutoReplayAttach({
    sessionId: isNew ? null : id ?? null,
    activeTurnId: session?.activeTurnId ?? null,
  });

  // Reset committed state when navigating between distinct sessions
  // (e.g. clicking a different history rail entry).
  const prevIdRef = useRef<string | undefined>(id);
  useEffect(() => {
    if (prevIdRef.current !== id) {
      // Only wipe if we're switching to an unrelated thread — NOT on the
      // synthetic `undefined → <new uuid>` transition triggered by
      // history.replace after session_created (committedMessages already
      // contains the user msg + streaming response we want to keep).
      const isReplaceAfterCreate = !prevIdRef.current && !!id;
      if (!isReplaceAfterCreate) {
        setCommittedMessages([]);
        hydratedRef.current = false;
      }
      prevIdRef.current = id;
    }
  }, [id]);

  useEffect(() => {
    if (!session || hydratedRef.current) return;
    hydratedRef.current = true;
    // If the user just submitted on /chat, committedMessages already holds the
    // locally-streamed turn (with its reasoning section). Hydrating from the
    // API would clobber that reasoning — reasoning lives in DB but only flows
    // through the live SSE path, so a freshly-loaded turn has the data the
    // server response does not. Skip hydration in that case.
    if (committedMessages.length > 0) return;
    setCommittedMessages(sessionTurnsToMessages(session.turns));
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cross-surface sync: mirror current route id into the panel's active
  // session store so the side panel (if open) shows the same conversation.
  useEffect(() => {
    if (id && id !== 'new') setActiveChatSession(id);
  }, [id]);

  const {
    status, sessionId: streamSessionId, turnId: streamTurnId,
    currentText, currentReasoning, currentArtifacts, currentCharts, currentToolCalls,
    cacheHit: streamCacheHit, cacheFreshness: streamCacheFreshness,
    disambigOptions: streamDisambigOptions,
    lastCompactWarning, retryAfterMs,
    error: streamError, errorTitle: streamErrorTitle, errorHint: streamErrorHint,
    sendTurn, cancel, reconnect, clearStreamBuffers, resetStream,
  } = useChatStream({ sessionId: isNew ? null : id ?? null, game: gameId });

  // Phase 04 — server-side cancel for the in-flight turn. Pairs the FE-side
  // `cancel` (closes the SSE fetch) with the POST that signals the registry
  // to abort the SDK iterator and release the session mutex.
  const { cancel: cancelTurnRemote, busy: cancelBusy } = useCancelTurn({
    turnId: streamTurnId,
    cancelLocal: cancel,
  });

  // Phase 03 — `/forget` slash command in the composer. We hook directly into
  // the focus hook so the command shares its forget action with the chip /
  // Settings without going through the SSE stream.
  const focusSessionId = streamSessionId ?? (id && id !== 'new' ? id : null);
  const { forget: forgetSessionFocus } = useSessionFocus(focusSessionId);

  // Navigate to real id once session is created from new. Use history.replace
  // (not push) so the back button doesn't bounce the user back to /chat.
  //
  // Fires every time `streamSessionId` diverges from the route `id`. The
  // `streamSessionId === id` guard prevents redundant replaces inside a
  // single chat cycle; a per-mount latch would cement the URL after the
  // first new chat and break back-to-back new chats — the URL would stay
  // at /chat while the SSE has already routed a fresh session id, and the
  // post-done guard in useChatStream would then strip the entry from the
  // null-pinned view, hiding the assistant reply from committedMessages.
  useEffect(() => {
    if (!streamSessionId || streamSessionId === id) return;
    history.replace(`/chat/${streamSessionId}`);
  }, [streamSessionId, id, history]);

  const buildStreamingSections = (): AssistantSection[] => {
    const sections: AssistantSection[] = [];
    // Order: thinking (reasoning + tool chips) → answer text → supporting
    // evidence (artifacts + standalone charts). During streaming this means
    // artifacts appear once text starts arriving — natural reading flow.
    if (currentReasoning) sections.push({ type: 'reasoning', text: currentReasoning });
    for (const tc of currentToolCalls) sections.push({ type: 'tool_call', id: tc.id, name: tc.name, status: tc.status, ms: tc.ms, summary: tc.summary });
    if (currentText) sections.push({ type: 'text', text: currentText });
    for (const art of currentArtifacts) sections.push({ type: 'query_artifact', artifact: art });
    // A chart attached to an artifact (chart.artifactRef === artifact.id) is
    // already drawn inside that artifact's card, so skip it here to avoid dups.
    const embeddedChartIds = new Set(
      currentArtifacts.map((a) => a.chart?.id).filter((x): x is string => !!x),
    );
    for (const ch of currentCharts) {
      if (embeddedChartIds.has(ch.id)) continue;
      sections.push({ type: 'chart', artifact: ch });
    }
    return sections;
  };

  const isStreaming = status === 'loading' || status === 'streaming';
  const displayMessages: ChatMessage[] = [...committedMessages];
  if (isStreaming) {
    const sections = buildStreamingSections();
    if (sections.length > 0) displayMessages.push({
      role: 'assistant',
      id: '__streaming__',
      sections,
      cacheHit: streamCacheHit,
      cacheFreshness: streamCacheFreshness,
      disambigOptions: streamDisambigOptions,
    });
  }

  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current !== 'done' && status === 'done') {
      const sections = buildStreamingSections();
      if (sections.length > 0) {
        // Snapshot cache + disambig flags before clearStreamBuffers runs —
        // once buffers clear, streamCacheHit / streamDisambigOptions reset.
        const committedCacheHit = streamCacheHit;
        const committedCacheFreshness = streamCacheFreshness;
        const committedDisambig = streamDisambigOptions;
        setCommittedMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            id: `${Date.now()}`,
            sections,
            ts: new Date().toISOString(),
            cacheHit: committedCacheHit,
            cacheFreshness: committedCacheFreshness,
            disambigOptions: committedDisambig,
          },
        ]);
      }
      // Clear stream buffers so the live preview doesn't render alongside the
      // committed turn. React 18 batches this with setCommittedMessages above,
      // so the swap happens in a single paint — no flicker.
      clearStreamBuffers();
    }
    prevStatusRef.current = status;
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zombie-stream reconciliation. If the in-flight turn is already persisted
  // server-side (its row id matches our streamTurnId) but our stream entry is
  // still showing it as in-flight or stalled — a dead socket never delivered
  // `done` — drop the stale entry and re-sync the committed answer from the DB.
  // Without this the user sees a frozen spinner / duplicate ghost bubble next to
  // the real answer. Gated on the turnId match so a freshly-started turn (not yet
  // persisted) is never reset out from under itself.
  useEffect(() => {
    if (!session || !streamTurnId) return;
    if (status !== 'loading' && status !== 'streaming' && status !== 'disconnected') return;
    const persisted = session.turns.find((t) => t.id === streamTurnId && t.role === 'assistant');
    if (!persisted) return;
    resetStream();
    setCommittedMessages(sessionTurnsToMessages(session.turns));
  }, [session, streamTurnId, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(() => {
    const text = composerValue.trim();
    if (!text) return;
    // Phase 03 — `/forget` slash command. Intercepts the submit so the text
    // never reaches the agent. Shows a synthetic user bubble for visual
    // feedback, then clears the composer + invokes the focus DELETE.
    if (text === '/forget' || text.startsWith('/forget ')) {
      setCommittedMessages((prev) => [
        ...prev,
        { role: 'user', id: `user-${Date.now()}`, text, ts: new Date().toISOString() },
      ]);
      setComposerValue('');
      void forgetSessionFocus();
      return;
    }
    setCommittedMessages((prev) => [...prev, { role: 'user', id: `user-${Date.now()}`, text, ts: new Date().toISOString() }]);
    setComposerValue('');
    sendTurn(text, bypassCache, webSearch, researchMode);
    // Reset bypass cache after send so the next turn uses the cache by default.
    if (bypassCache) setBypassCache(false);
    // Web search and research mode are intentionally kept ON between turns (sticky toggles).
  }, [composerValue, sendTurn, bypassCache, webSearch, researchMode, forgetSessionFocus]);

  /**
   * Starter-chip click on the empty hero: submit the chip text as a user
   * turn immediately (no prefill step). Honors the composer toggles exactly
   * like handleSubmit — a chip click IS a submit, just with provided text.
   */
  const handleSubmitText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      setCommittedMessages((prev) => [
        ...prev,
        { role: 'user', id: `user-${Date.now()}`, text: trimmed, ts: new Date().toISOString() },
      ]);
      setComposerValue('');
      sendTurn(trimmed, bypassCache, webSearch, researchMode);
      if (bypassCache) setBypassCache(false);
    },
    [isStreaming, sendTurn, bypassCache, webSearch, researchMode],
  );

  /**
   * Phase-04: follow-up chip click prefills + sends immediately. Bypasses
   * composer state to avoid the user briefly seeing the chip text before
   * the send fires.
   */
  const handleFollowupPick = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      setCommittedMessages((prev) => [
        ...prev,
        { role: 'user', id: `user-${Date.now()}`, text: trimmed, ts: new Date().toISOString() },
      ]);
      sendTurn(trimmed);
    },
    [isStreaming, sendTurn],
  );

  /**
   * Disambiguation chip click. Sends the chip's pinText as the next user
   * message; the BE disambig tool then resolves the slot using its memory
   * adapter (kv_cache(disambig_resolution)). Future turns of the same session
   * skip clarify for this slot.
   */
  const handleDisambigPick = useCallback(
    (pinText: string) => {
      const trimmed = pinText.trim();
      if (!trimmed || isStreaming) return;
      setCommittedMessages((prev) => [
        ...prev,
        { role: 'user', id: `user-${Date.now()}`, text: trimmed, ts: new Date().toISOString() },
      ]);
      sendTurn(trimmed);
    },
    [isStreaming, sendTurn],
  );

  // Loading splash for direct visits to an existing /chat/:id before the
  // session payload arrives. Skip for new threads (no fetch happening).
  if (!isNew && isLoading && committedMessages.length === 0) {
    return <div style={{ padding: 32, fontFamily: T.fSans, fontSize: 13, color: 'var(--shell-text-faint)' }}>Loading conversation…</div>;
  }

  // 403 — session exists but caller has no access (private, not their session).
  if (forbidden) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 8,
          fontFamily: T.fSans,
          color: 'var(--shell-text-subtle)',
          padding: '48px 32px',
          textAlign: 'center',
        }}
      >
        <span style={{ fontSize: 32, lineHeight: 1 }}>🔒</span>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--shell-text-emphasis)' }}>
          No access
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--shell-text-subtle)' }}>
          This conversation is private or doesn't exist.
        </p>
        <Link
          to="/chat"
          style={{ marginTop: 8, fontSize: 13, color: 'var(--shell-brand)', textDecoration: 'none', fontFamily: T.fSans }}
        >
          Start a new chat
        </Link>
      </div>
    );
  }

  // Derive sharing / read-only state from loaded session.
  const isShared = session?.visibility === 'shared';
  const isReadOnly = session?.readOnly ?? false;

  // Debug link: shown only when showDebugLinks setting is on and a real session id exists.
  const activeSessionId = streamSessionId ?? (id && id !== 'new' ? id : null);
  const showDebugLink = readChatServiceSettings().showDebugLinks && !!activeSessionId;

  const topBanner =
    status === 'disconnected' ? <DisconnectBanner onReconnect={reconnect} /> :
    status === 'rate_limited' && retryAfterMs != null ? <RateLimitedBanner retryAfterMs={retryAfterMs} /> :
    null;

  // Empty-new state: centered hero + composer, no thread/banner chrome.
  // Triggered ONLY before any user submit — once committedMessages has a
  // bubble or the stream starts, fall through to the normal thread view so
  // the user's message bubble appears immediately.
  const isEmptyNew = isNew && committedMessages.length === 0 && !isStreaming;

  return (
    <div
      data-testid="chat-thread-page"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        background: 'var(--surface-raised)',
        overflow: 'hidden',
      }}
    >
      {/* Center the thread on wide viewports so long lines stay readable.
       *  Inner wrapper caps at 880px and inherits column layout from the
       *  outer flex:1 box, which still spans full width for background.
       *  The OUTER box owns the scroll so the scrollbar tracks the viewport's
       *  right edge instead of the 880px column's edge (less visual noise). */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', overflowY: 'auto' }}>
        <div
          style={{
            width: '100%',
            maxWidth: 880,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            paddingInline: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 10,
              padding: '6px 0 2px',
            }}
          >
            <ChatHeaderFocusChip sessionId={activeSessionId} />
            <ChatModeChip sessionId={activeSessionId} />
            {/* Share toggle — only for the session owner (not new, not readOnly) */}
            {!isNew && !isReadOnly && activeSessionId && session && (
              <ChatShareButton
                sessionId={activeSessionId}
                shared={isShared}
                onChanged={refetchSession}
              />
            )}
            {showDebugLink && (
              <Link
                to={`/dev/chat-audit/sessions/${activeSessionId}`}
                style={{ fontSize: 11, color: 'var(--shell-text-faint)', textDecoration: 'none', fontFamily: T.fSans }}
              >
                Debug
              </Link>
            )}
          </div>
          {isEmptyNew ? (
            <ChatEmptyHero
              composerValue={composerValue}
              onChange={setComposerValue}
              onSubmit={handleSubmit}
              onSubmitText={handleSubmitText}
              disabled={isStreaming}
              bypassCache={bypassCache}
              onToggleBypassCache={() => setBypassCache((v) => !v)}
              webSearch={webSearch}
              onToggleWebSearch={() => setWebSearch((v) => !v)}
              researchMode={researchMode}
              onToggleResearchMode={() => setResearchMode((v) => !v)}
            />
          ) : (
            <ChatThreadView
              messages={displayMessages}
              streaming={isStreaming}
              composerValue={composerValue}
              onComposerChange={setComposerValue}
              onSubmit={handleSubmit}
              banner={topBanner}
              onFollowupPick={handleFollowupPick}
              onDisambigPick={handleDisambigPick}
              bypassCache={bypassCache}
              onToggleBypassCache={() => setBypassCache((v) => !v)}
              webSearch={webSearch}
              onToggleWebSearch={() => setWebSearch((v) => !v)}
              researchMode={researchMode}
              onToggleResearchMode={() => setResearchMode((v) => !v)}
              readOnly={isReadOnly}
              cancelSlot={
                <TurnCancelButton
                  turnId={streamTurnId}
                  isStreaming={isStreaming}
                  onCancel={cancelTurnRemote}
                  busy={cancelBusy}
                />
              }
            />
          )}
          {lastCompactWarning && status === 'done' && <CompactWarningChip />}
          {status === 'error' && (
            <ErrorBanner
              onDismiss={cancel}
              title={streamErrorTitle}
              hint={streamErrorHint}
              detail={streamError}
            />
          )}
        </div>
      </div>
    </div>
  );
}

