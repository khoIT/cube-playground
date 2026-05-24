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
import { useHistory, useParams } from 'react-router-dom';
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
import type { ChatMessage } from './components/chat-message-list';
import type { AssistantSection } from './components/assistant-message';


// ---------------------------------------------------------------------------
// Helper — convert persisted session turns → ChatMessage[]
// ---------------------------------------------------------------------------

function sessionTurnsToMessages(
  turns: ReturnType<typeof useChatSession>['session'] extends null
    ? never
    : ReturnType<typeof useChatSession>['session']['turns'],
): ChatMessage[] {
  return turns.map((t) => {
    if (t.role === 'user') return { role: 'user', id: t.id, text: t.text, ts: t.createdAt };
    const sections: AssistantSection[] = [];
    if (t.text) sections.push({ type: 'text', text: t.text });
    for (const tc of t.toolCalls ?? []) {
      sections.push({ type: 'tool_call', id: tc.id, name: tc.name, status: tc.ok ? 'ok' : 'error', ms: tc.ms, summary: tc.summary });
    }
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
    return { role: 'assistant', id: t.id, sections };
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
  const hydratedRef = useRef(false);

  const { session, isLoading } = useChatSession(isNew ? null : id ?? null);

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
    setCommittedMessages(sessionTurnsToMessages(session.turns));
  }, [session]);

  // Cross-surface sync: mirror current route id into the panel's active
  // session store so the side panel (if open) shows the same conversation.
  useEffect(() => {
    if (id && id !== 'new') setActiveChatSession(id);
  }, [id]);

  const {
    status, sessionId: streamSessionId,
    currentText, currentReasoning, currentArtifacts, currentCharts, currentToolCalls,
    lastCompactWarning, retryAfterMs,
    sendTurn, cancel, reconnect, clearStreamBuffers,
  } = useChatStream({ sessionId: isNew ? null : id ?? null, game: gameId });

  // Navigate to real id once session is created from new. Use history.replace
  // (not push) so the back button doesn't bounce the user back to /chat.
  const replacedRef = useRef(false);
  useEffect(() => {
    if (!streamSessionId || streamSessionId === id || replacedRef.current) return;
    replacedRef.current = true;
    history.replace(`/chat/${streamSessionId}`);
  }, [streamSessionId, id, history]);

  const buildStreamingSections = (): AssistantSection[] => {
    const sections: AssistantSection[] = [];
    if (currentReasoning) sections.push({ type: 'reasoning', text: currentReasoning });
    for (const tc of currentToolCalls) sections.push({ type: 'tool_call', id: tc.id, name: tc.name, status: tc.status, ms: tc.ms, summary: tc.summary });
    for (const art of currentArtifacts) sections.push({ type: 'query_artifact', artifact: art });
    // Standalone charts (not artifact-embedded) render after artifacts, before text.
    // A chart attached to an artifact (chart.artifactRef === artifact.id) is
    // already drawn inside that artifact's card, so skip it here to avoid dups.
    const embeddedChartIds = new Set(
      currentArtifacts.map((a) => a.chart?.id).filter((x): x is string => !!x),
    );
    for (const ch of currentCharts) {
      if (embeddedChartIds.has(ch.id)) continue;
      sections.push({ type: 'chart', artifact: ch });
    }
    if (currentText) sections.push({ type: 'text', text: currentText });
    return sections;
  };

  const isStreaming = status === 'loading' || status === 'streaming';
  const displayMessages: ChatMessage[] = [...committedMessages];
  if (isStreaming) {
    const sections = buildStreamingSections();
    if (sections.length > 0) displayMessages.push({ role: 'assistant', id: '__streaming__', sections });
  }

  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current !== 'done' && status === 'done') {
      const sections = buildStreamingSections();
      if (sections.length > 0) {
        setCommittedMessages((prev) => [...prev, { role: 'assistant', id: `${Date.now()}`, sections }]);
      }
      // Clear stream buffers so the live preview doesn't render alongside the
      // committed turn. React 18 batches this with setCommittedMessages above,
      // so the swap happens in a single paint — no flicker.
      clearStreamBuffers();
    }
    prevStatusRef.current = status;
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(() => {
    const text = composerValue.trim();
    if (!text) return;
    setCommittedMessages((prev) => [...prev, { role: 'user', id: `user-${Date.now()}`, text, ts: new Date().toISOString() }]);
    setComposerValue('');
    sendTurn(text);
  }, [composerValue, sendTurn]);

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

  // Loading splash for direct visits to an existing /chat/:id before the
  // session payload arrives. Skip for new threads (no fetch happening).
  if (!isNew && isLoading && committedMessages.length === 0) {
    return <div style={{ padding: 32, fontFamily: T.fSans, fontSize: 13, color: T.n400 }}>Loading conversation…</div>;
  }

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
        background: T.surface,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {isEmptyNew ? (
          <ChatEmptyHero
            composerValue={composerValue}
            onChange={setComposerValue}
            onSubmit={handleSubmit}
            disabled={isStreaming}
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
          />
        )}
        {lastCompactWarning && status === 'done' && <CompactWarningChip />}
        {status === 'error' && <ErrorBanner onDismiss={cancel} />}
      </div>
    </div>
  );
}

