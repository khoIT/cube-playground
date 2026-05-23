/**
 * usePanelChatState — wires useChatStream + useChatSession for the side panel.
 * Mirrors the logic in ChatThreadPage but operates on the panel's active session
 * (from useActiveChatSession) rather than a URL param.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useChatSession } from '../../pages/Chat/hooks/use-chat-session';
import { useChatStream } from '../../pages/Chat/hooks/use-chat-stream';
import type { ChatMessage } from '../../pages/Chat/components/chat-message-list';
import type { AssistantSection } from '../../pages/Chat/components/assistant-message';

function turnsToMessages(
  turns: NonNullable<ReturnType<typeof useChatSession>['session']>['turns'],
): ChatMessage[] {
  return turns.map((t) => {
    if (t.role === 'user') {
      return { role: 'user', id: t.id, text: t.text, ts: t.createdAt };
    }
    const sections: AssistantSection[] = [];
    if (t.text) sections.push({ type: 'text', text: t.text });
    for (const tc of t.toolCalls ?? []) {
      sections.push({ type: 'tool_call', id: tc.id, name: tc.name, status: tc.ok ? 'ok' : 'error', ms: tc.ms, summary: tc.summary });
    }
    const embeddedChartIds = new Set<string>();
    for (const art of t.artifacts ?? []) {
      if (art.chart?.id) embeddedChartIds.add(art.chart.id);
      sections.push({
        type: 'query_artifact',
        artifact: {
          id: art.id, title: art.title, summary: art.summary,
          deeplinkUrl: art.deeplinkUrl, deeplinkVia: art.deeplinkVia,
          source: art.source as 'business-metric' | 'segment' | 'raw',
          sourceRef: art.sourceRef, payload: art.payload, query: art.query,
          chart: art.chart,
        },
      });
    }
    for (const ch of t.charts ?? []) {
      if (embeddedChartIds.has(ch.id)) continue;
      sections.push({ type: 'chart', artifact: ch });
    }
    return { role: 'assistant', id: t.id, sections };
  });
}

export interface PanelChatState {
  displayMessages: ChatMessage[];
  isStreaming: boolean;
  composerValue: string;
  setComposerValue: (v: string) => void;
  handleSubmit: () => void;
  cancel: () => void;
  status: ReturnType<typeof useChatStream>['status'];
  /** Updated session id (may differ from input when a new session is created). */
  liveSessionId: string | null;
  firstUserMessage: string | null;
}

export function usePanelChatState(sessionId: string | null): PanelChatState {
  const gameId = useActiveGameId();

  const [composerValue, setComposerValue] = useState('');
  const [committedMessages, setCommittedMessages] = useState<ChatMessage[]>([]);
  const [firstUserMessage, setFirstUserMessage] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  // Reset committed state when sessionId changes (new chat or different session).
  const prevSessionRef = useRef(sessionId);
  useEffect(() => {
    if (prevSessionRef.current !== sessionId) {
      prevSessionRef.current = sessionId;
      setCommittedMessages([]);
      setFirstUserMessage(null);
      hydratedRef.current = false;
    }
  }, [sessionId]);

  const { session } = useChatSession(sessionId);

  useEffect(() => {
    if (!session || hydratedRef.current) return;
    hydratedRef.current = true;
    const msgs = turnsToMessages(session.turns);
    setCommittedMessages(msgs);
    const first = msgs.find((m) => m.role === 'user');
    if (first && first.role === 'user') setFirstUserMessage(first.text);
  }, [session]);

  const {
    status,
    sessionId: streamSessionId,
    currentText,
    currentReasoning,
    currentArtifacts,
    currentCharts,
    currentToolCalls,
    sendTurn,
    cancel,
    clearStreamBuffers,
  } = useChatStream({ sessionId, game: gameId });

  const buildStreamingSections = (): AssistantSection[] => {
    const s: AssistantSection[] = [];
    if (currentReasoning) s.push({ type: 'reasoning', text: currentReasoning });
    for (const tc of currentToolCalls) s.push({ type: 'tool_call', id: tc.id, name: tc.name, status: tc.status, ms: tc.ms, summary: tc.summary });
    for (const art of currentArtifacts) s.push({ type: 'query_artifact', artifact: art });
    // Skip charts that are already embedded inside one of the emitted artifacts.
    const embeddedChartIds = new Set(
      currentArtifacts.map((a) => a.chart?.id).filter((x): x is string => !!x),
    );
    for (const ch of currentCharts) {
      if (embeddedChartIds.has(ch.id)) continue;
      s.push({ type: 'chart', artifact: ch });
    }
    if (currentText) s.push({ type: 'text', text: currentText });
    return s;
  };

  const isStreaming = status === 'loading' || status === 'streaming';

  const displayMessages: ChatMessage[] = [...committedMessages];
  if (isStreaming) {
    const sections = buildStreamingSections();
    if (sections.length > 0) {
      displayMessages.push({ role: 'assistant', id: '__streaming__', sections });
    }
  }

  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current !== 'done' && status === 'done') {
      const sections = buildStreamingSections();
      if (sections.length > 0) {
        setCommittedMessages((prev) => [...prev, { role: 'assistant', id: `${Date.now()}`, sections }]);
      }
      // Clear stream buffers so the live preview doesn't render alongside the
      // committed turn. React 18 batches this with setCommittedMessages above.
      clearStreamBuffers();
    }
    prevStatusRef.current = status;
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(() => {
    const text = composerValue.trim();
    if (!text) return;
    if (!firstUserMessage) setFirstUserMessage(text);
    setCommittedMessages((prev) => [...prev, { role: 'user', id: `user-${Date.now()}`, text, ts: new Date().toISOString() }]);
    setComposerValue('');
    sendTurn(text);
  }, [composerValue, sendTurn, firstUserMessage]);

  return {
    displayMessages,
    isStreaming,
    composerValue,
    setComposerValue,
    handleSubmit,
    cancel,
    status,
    liveSessionId: streamSessionId,
    firstUserMessage,
  };
}
