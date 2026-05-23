/**
 * ChatLandingPage — /chat entry point.
 * Two-pane layout at ≥768px: left history rail (280px) + right composer column.
 * Mobile (<768px): full-width composer column only.
 *
 * Submitting the composer creates a new session via openChatTurn and navigates
 * to /chat/:id once session_created fires.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { openChatTurn } from '../../api/chat-sse-client';
import { ChatComposer } from './components/chat-composer';
import { ChatHistoryRail } from './components/chat-history-rail';
import { useWindowWidth } from './hooks/use-window-width';

const MD_BREAKPOINT = 768;

export function ChatLandingPage() {
  const history = useHistory();
  const gameId = useActiveGameId();
  const windowWidth = useWindowWidth();
  const isWide = windowWidth >= MD_BREAKPOINT;

  const [composerValue, setComposerValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

  // Cancel any in-flight request on unmount.
  useEffect(() => () => { cancelRef.current?.(); }, []);

  const handleSubmit = useCallback(async () => {
    const message = composerValue.trim();
    if (!message || submitting) return;

    setSubmitting(true);
    setComposerValue('');

    const { stream, cancel } = openChatTurn({ sessionId: null, message, game: gameId });
    cancelRef.current = cancel;

    try {
      for await (const event of stream) {
        if (event.type === 'session_created') {
          history.push(`/chat/${event.data.id}`);
          return;
        }
        if (event.type === 'error') {
          setSubmitting(false);
          return;
        }
        if (event.type === 'done') {
          setSubmitting(false);
          return;
        }
      }
    } catch {
      setSubmitting(false);
    } finally {
      cancelRef.current = null;
    }
  }, [composerValue, submitting, gameId, history]);

  return (
    <div
      data-testid="chat-landing-page"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        background: T.surface,
        overflow: 'hidden',
      }}
    >
      {isWide && <ChatHistoryRail />}

      {/* Main composer column */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px 48px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 760 }}>
          <h1
            style={{
              fontFamily: T.fDisp,
              fontSize: 40,
              fontWeight: 400,
              letterSpacing: '0.01em',
              textTransform: 'uppercase',
              color: T.n950,
              margin: '0 0 32px',
              textAlign: 'center',
            }}
          >
            What do you want to ask?
          </h1>

          <ChatComposer
            value={composerValue}
            onChange={setComposerValue}
            onSubmit={handleSubmit}
            disabled={submitting}
            compact={false}
            placeholder="Ask anything about your data…"
          />
        </div>
      </div>
    </div>
  );
}
