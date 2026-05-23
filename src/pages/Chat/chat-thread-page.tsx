/**
 * ChatThreadPage — route component for /chat/:id.
 *
 *   :id === 'new'  → empty thread; first sendTurn creates session, then
 *                    history.replace('/chat/<new-id>') on session_created.
 *   :id === <uuid> → load history via useChatSession, then stream continued turns.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { ChatThreadView } from './components/chat-thread-view';
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
    for (const art of t.artifacts ?? []) {
      sections.push({ type: 'query_artifact', artifact: {
        id: art.id, title: art.title, summary: art.summary,
        deeplinkUrl: art.deeplinkUrl, deeplinkVia: art.deeplinkVia,
        source: art.source as 'business-metric' | 'segment' | 'raw',
        sourceRef: art.sourceRef, payload: art.payload, query: art.query,
      }});
    }
    return { role: 'assistant', id: t.id, sections };
  });
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function ChatThreadPage() {
  const { id } = useParams<{ id: string }>();
  const history = useHistory();
  const gameId = useActiveGameId();
  const isNew = !id || id === 'new';

  const [composerValue, setComposerValue] = useState('');
  const [committedMessages, setCommittedMessages] = useState<ChatMessage[]>([]);
  const hydratedRef = useRef(false);

  const { session, isLoading } = useChatSession(isNew ? null : id);

  useEffect(() => {
    if (!session || hydratedRef.current) return;
    hydratedRef.current = true;
    setCommittedMessages(sessionTurnsToMessages(session.turns));
  }, [session]);

  const {
    status, sessionId: streamSessionId,
    currentText, currentReasoning, currentArtifacts, currentToolCalls,
    lastCompactWarning, retryAfterMs,
    sendTurn, cancel, reconnect, clearStreamBuffers,
  } = useChatStream({ sessionId: isNew ? null : id, game: gameId });

  // Navigate to real id once session is created from 'new'.
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

  if (!isNew && isLoading && committedMessages.length === 0) {
    return <div style={{ padding: 32, fontFamily: T.fSans, fontSize: 13, color: T.n400 }}>Loading conversation…</div>;
  }

  const topBanner =
    status === 'disconnected' ? <DisconnectBanner onReconnect={reconnect} /> :
    status === 'rate_limited' && retryAfterMs != null ? <RateLimitedBanner retryAfterMs={retryAfterMs} /> :
    null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.surface }}>
      <ChatThreadView
        messages={displayMessages}
        streaming={isStreaming}
        composerValue={composerValue}
        onComposerChange={setComposerValue}
        onSubmit={handleSubmit}
        banner={topBanner}
      />
      {lastCompactWarning && status === 'done' && <CompactWarningChip />}
      {status === 'error' && <ErrorBanner onDismiss={cancel} />}
    </div>
  );
}
