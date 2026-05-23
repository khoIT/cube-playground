/**
 * ChatThreadPage — route component for /chat/:id.
 *
 * Behaviour:
 *   :id === 'new'  → empty thread; first sendTurn creates session, then
 *                    history.replace('/chat/<new-id>') on session_created.
 *   :id === <uuid> → load history via useChatSession, then attach useChatStream
 *                    for continued turns.
 *
 * Game id is read from the global GameContext (useActiveGameId).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { ChatThreadView } from './components/chat-thread-view';
import { useChatSession } from './hooks/use-chat-session';
import { useChatStream } from './hooks/use-chat-stream';
import type { ChatMessage } from './components/chat-message-list';
import type { AssistantSection } from './components/assistant-message';

// ---------------------------------------------------------------------------
// Helpers — convert session turns → ChatMessage[]
// ---------------------------------------------------------------------------

function sessionTurnsToMessages(
  turns: ReturnType<typeof useChatSession>['session'] extends null
    ? never
    : ReturnType<typeof useChatSession>['session']['turns'],
): ChatMessage[] {
  return turns.map((t) => {
    if (t.role === 'user') {
      return { role: 'user', id: t.id, text: t.text, ts: t.createdAt };
    }
    // Reconstruct assistant sections from persisted turn data.
    const sections: AssistantSection[] = [];
    if (t.text) sections.push({ type: 'text', text: t.text });
    for (const tc of t.toolCalls ?? []) {
      sections.push({
        type: 'tool_call',
        id: tc.id,
        name: tc.name,
        status: tc.ok ? 'ok' : 'error',
        ms: tc.ms,
        summary: tc.summary,
      });
    }
    for (const art of t.artifacts ?? []) {
      sections.push({
        type: 'query_artifact',
        artifact: {
          id: art.id,
          title: art.title,
          summary: art.summary,
          deeplinkUrl: art.deeplinkUrl,
          deeplinkVia: art.deeplinkVia,
          source: art.source as 'business-metric' | 'segment' | 'raw',
          sourceRef: art.sourceRef,
          payload: art.payload,
          query: art.query,
        },
      });
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

  // Composer controlled state.
  const [composerValue, setComposerValue] = useState('');

  // Committed chat messages for display (persisted history + live turn).
  const [committedMessages, setCommittedMessages] = useState<ChatMessage[]>([]);

  // Track whether we have hydrated from session yet (avoid double-hydration).
  const hydratedRef = useRef(false);

  // Load existing session history.
  const { session, isLoading } = useChatSession(isNew ? null : id);

  // Hydrate committed messages once session loads.
  useEffect(() => {
    if (!session || hydratedRef.current) return;
    hydratedRef.current = true;
    setCommittedMessages(sessionTurnsToMessages(session.turns));
  }, [session]);

  // Stream hook — sessionId starts as current id (or null for new).
  const {
    status,
    sessionId: streamSessionId,
    currentText,
    currentReasoning,
    currentArtifacts,
    currentToolCalls,
    sendTurn,
    cancel,
  } = useChatStream({ sessionId: isNew ? null : id, game: gameId });

  // When session_created fires (new → real id), update the URL.
  const replacedRef = useRef(false);
  useEffect(() => {
    if (!streamSessionId || streamSessionId === id || replacedRef.current) return;
    replacedRef.current = true;
    history.replace(`/chat/${streamSessionId}`);
  }, [streamSessionId, id, history]);

  // Build in-progress assistant sections from live stream state.
  const buildStreamingSections = (): AssistantSection[] => {
    const sections: AssistantSection[] = [];
    if (currentReasoning) sections.push({ type: 'reasoning', text: currentReasoning });
    for (const tc of currentToolCalls) {
      sections.push({ type: 'tool_call', id: tc.id, name: tc.name, status: tc.status, ms: tc.ms, summary: tc.summary });
    }
    for (const art of currentArtifacts) {
      sections.push({ type: 'query_artifact', artifact: art });
    }
    if (currentText) sections.push({ type: 'text', text: currentText });
    return sections;
  };

  // Compose the full message list: committed history + live in-progress message.
  const isStreaming = status === 'loading' || status === 'streaming';
  const inProgressId = '__streaming__';

  const displayMessages: ChatMessage[] = [...committedMessages];
  if (isStreaming || (status === 'done' && currentText)) {
    const sections = buildStreamingSections();
    if (sections.length > 0) {
      displayMessages.push({ role: 'assistant', id: inProgressId, sections });
    }
  }

  // On turn completion, commit the streaming message to permanent list.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current !== 'done' && status === 'done') {
      const sections = buildStreamingSections();
      if (sections.length > 0) {
        setCommittedMessages((prev) => [
          ...prev,
          { role: 'assistant', id: `${Date.now()}`, sections },
        ]);
      }
    }
    prevStatusRef.current = status;
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(() => {
    const text = composerValue.trim();
    if (!text) return;

    // Append the user message immediately for optimistic display.
    const userMsg: ChatMessage = {
      role: 'user',
      id: `user-${Date.now()}`,
      text,
      ts: new Date().toISOString(),
    };
    setCommittedMessages((prev) => [...prev, userMsg]);
    setComposerValue('');

    sendTurn(text);
  }, [composerValue, sendTurn]);

  // Loading state for history rehydration.
  if (!isNew && isLoading && committedMessages.length === 0) {
    return (
      <div style={{ padding: 32, fontFamily: T.fSans, fontSize: 13, color: T.n400 }}>
        Loading conversation…
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: T.surface,
      }}
    >
      <ChatThreadView
        messages={displayMessages}
        streaming={isStreaming}
        composerValue={composerValue}
        onComposerChange={setComposerValue}
        onSubmit={handleSubmit}
      />

      {/* Error banner */}
      {status === 'error' && (
        <div
          style={{
            padding: '8px 16px',
            background: T.redSoft,
            borderTop: `1px solid ${T.red500}`,
            fontFamily: T.fSans,
            fontSize: 13,
            color: T.red600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Something went wrong. Please try again.</span>
          <button
            type="button"
            onClick={cancel}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.red600, fontFamily: T.fSans, fontSize: 13 }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
