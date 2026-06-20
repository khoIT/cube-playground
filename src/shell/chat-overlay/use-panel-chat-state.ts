/**
 * usePanelChatState — wires useChatStream + useChatSession for the side panel.
 * Mirrors the logic in ChatThreadPage but operates on the panel's active session
 * (from useActiveChatSession) rather than a URL param.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useChatSession } from '../../pages/Chat/hooks/use-chat-session';
import { useChatStream } from '../../pages/Chat/hooks/use-chat-stream';
import { useAutoReplayAttach } from '../../pages/Chat/hooks/use-auto-replay-attach';
import { useSessionFocus } from '../../pages/Chat/hooks/use-session-focus';
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
      sections.push({
        type: 'query_artifact',
        artifact: {
          id: art.id, title: art.title, summary: art.summary,
          deeplinkUrl: art.deeplinkUrl, deeplinkVia: art.deeplinkVia,
          source: art.source as 'business-metric' | 'segment' | 'raw',
          sourceRef: art.sourceRef, payload: art.payload, query: art.query,
          chart: art.chart, overlay: art.overlay, combined: art.combined,
          game: art.game,
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
  /** Cancel + wipe committed messages and composer. Used by "New chat". */
  resetChat: () => void;
  status: ReturnType<typeof useChatStream>['status'];
  /** Updated session id (may differ from input when a new session is created). */
  liveSessionId: string | null;
  /** Phase 04 — active turnId for the cancel button. Null until turn_started. */
  liveTurnId: string | null;
  firstUserMessage: string | null;
  /** Bypass cache toggle — per-turn; resets after each send (matches the page). */
  bypassCache: boolean;
  onToggleBypassCache: () => void;
  /** Web search toggle state for the panel composer. */
  webSearch: boolean;
  onToggleWebSearch: () => void;
  /** Research mode toggle state for the panel composer. */
  researchMode: boolean;
  onToggleResearchMode: () => void;
}

export function usePanelChatState(sessionId: string | null): PanelChatState {
  const gameId = useActiveGameId();

  const [composerValue, setComposerValue] = useState('');
  const [committedMessages, setCommittedMessages] = useState<ChatMessage[]>([]);
  const [firstUserMessage, setFirstUserMessage] = useState<string | null>(null);
  const [bypassCache, setBypassCache] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [researchMode, setResearchMode] = useState(false);
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

  // Refresh-resume: pick up a server-side in-flight turn into the store.
  useAutoReplayAttach({
    sessionId,
    activeTurnId: session?.activeTurnId ?? null,
  });

  useEffect(() => {
    if (!session || hydratedRef.current) return;
    // Guard the hydration race: useChatSession briefly retains the previous
    // session's data after sessionId flips (its own RESET fires in a later
    // effect tick). Without this check, "New chat" → null re-hydrates the
    // just-cleared committedMessages from stale state.
    if (session.id !== sessionId) return;
    hydratedRef.current = true;
    // Already streamed this turn locally (reasoning section lives only on the
    // live SSE path; hydrating from the API would drop it). Same rationale as
    // the chat-thread-page guard.
    if (committedMessages.length > 0) return;
    const msgs = turnsToMessages(session.turns);
    setCommittedMessages(msgs);
    const first = msgs.find((m) => m.role === 'user');
    if (first && first.role === 'user') setFirstUserMessage(first.text);
  }, [session, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    status,
    sessionId: streamSessionId,
    turnId: streamTurnId,
    currentText,
    currentReasoning,
    currentArtifacts,
    currentCharts,
    currentToolCalls,
    sendTurn,
    cancel,
    clearStreamBuffers,
    resetStream,
  } = useChatStream({ sessionId, game: gameId });

  const buildStreamingSections = (): AssistantSection[] => {
    const s: AssistantSection[] = [];
    // Order: thinking (reasoning + tool chips) → answer text → supporting
    // evidence (artifacts + standalone charts). During streaming this means
    // artifacts appear once text starts arriving — natural reading flow.
    if (currentReasoning) s.push({ type: 'reasoning', text: currentReasoning });
    for (const tc of currentToolCalls) s.push({ type: 'tool_call', id: tc.id, name: tc.name, status: tc.status, ms: tc.ms, summary: tc.summary });
    if (currentText) s.push({ type: 'text', text: currentText });
    for (const art of currentArtifacts) s.push({ type: 'query_artifact', artifact: art });
    // Skip charts that are already embedded inside one of the emitted artifacts.
    const embeddedChartIds = new Set(
      currentArtifacts.map((a) => a.chart?.id).filter((x): x is string => !!x),
    );
    for (const ch of currentCharts) {
      if (embeddedChartIds.has(ch.id)) continue;
      s.push({ type: 'chart', artifact: ch });
    }
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

  // Zombie-stream reconciliation (mirrors chat-thread-page). If the in-flight
  // turn is already persisted server-side but our stream entry still shows it
  // in-flight/stalled (dead socket, no `done`), drop the stale entry and re-sync
  // the committed answer from the DB. Gated on the turnId match so a freshly-
  // started turn isn't reset before it persists.
  useEffect(() => {
    if (!session || !streamTurnId) return;
    if (status !== 'loading' && status !== 'streaming' && status !== 'disconnected') return;
    const persisted = session.turns.find((t) => t.id === streamTurnId && t.role === 'assistant');
    if (!persisted) return;
    resetStream();
    setCommittedMessages(turnsToMessages(session.turns));
  }, [session, streamTurnId, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 03 — `/forget` support inside the side-panel composer. Shares the
  // GET/DELETE focus client with the chip + Settings.
  const focusSessionIdForForget = streamSessionId ?? sessionId;
  const { forget: forgetSessionFocus } = useSessionFocus(focusSessionIdForForget);

  const handleSubmit = useCallback(() => {
    const text = composerValue.trim();
    if (!text) return;
    if (text === '/forget' || text.startsWith('/forget ')) {
      setCommittedMessages((prev) => [
        ...prev,
        { role: 'user', id: `user-${Date.now()}`, text, ts: new Date().toISOString() },
      ]);
      setComposerValue('');
      void forgetSessionFocus();
      return;
    }
    if (!firstUserMessage) setFirstUserMessage(text);
    setCommittedMessages((prev) => [...prev, { role: 'user', id: `user-${Date.now()}`, text, ts: new Date().toISOString() }]);
    setComposerValue('');
    sendTurn(text, bypassCache, webSearch, researchMode);
    // Reset bypass cache after send so the next turn uses the cache by default.
    if (bypassCache) setBypassCache(false);
    // Web search and research mode are intentionally kept ON between turns (sticky toggles).
  }, [composerValue, sendTurn, firstUserMessage, bypassCache, webSearch, researchMode, forgetSessionFocus]);

  // Explicit reset for "New chat" — needed because clicking + when sessionId
  // is already null is a no-op for the sessionId-change effect, leaving the
  // locally-pushed user bubble visible until session_created arrives.
  const resetChat = useCallback(() => {
    cancel();
    setCommittedMessages([]);
    setFirstUserMessage(null);
    setComposerValue('');
    setBypassCache(false);
    hydratedRef.current = false;
  }, [cancel]);

  return {
    displayMessages,
    isStreaming,
    composerValue,
    setComposerValue,
    handleSubmit,
    cancel,
    resetChat,
    status,
    liveSessionId: streamSessionId,
    liveTurnId: streamTurnId,
    firstUserMessage,
    bypassCache,
    onToggleBypassCache: () => setBypassCache((v) => !v),
    webSearch,
    onToggleWebSearch: () => setWebSearch((v) => !v),
    researchMode,
    onToggleResearchMode: () => setResearchMode((v) => !v),
  };
}
