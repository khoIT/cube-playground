/**
 * ChatMessageList — scrollable list of user + assistant turns.
 * Auto-scrolls to bottom on new content. Shows TypingDots when streaming.
 */
import React, { useEffect, useRef } from 'react';
import { T } from '../../../shell/theme';
import { UserMessage } from './user-message';
import { AssistantMessage, type AssistantSection } from './assistant-message';
import { TypingDots } from './typing-dots';

// ---------------------------------------------------------------------------
// Message shape
// ---------------------------------------------------------------------------

export interface UserChatMessage {
  role: 'user';
  id: string;
  text: string;
  ts?: string;
}

export interface AssistantChatMessage {
  role: 'assistant';
  id: string;
  sections: AssistantSection[];
  /** ISO timestamp of the turn — surfaced in the header next to "Cube". */
  ts?: string;
  /** True when this turn was served from the response cache (vs live LLM). */
  cacheHit?: boolean;
  /** Freshness of cached payload — set only when cacheHit=true. */
  cacheFreshness?: 'refreshed' | 'stale' | null;
}

export type ChatMessage = UserChatMessage | AssistantChatMessage;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ChatMessageListProps {
  messages: ChatMessage[];
  /** If true and last message is assistant, appends TypingDots after it. */
  streaming?: boolean;
  /**
   * Fired when the user clicks a follow-up chip (phase-04). The chip text
   * is intended to be prefilled into the composer and submitted.
   */
  onFollowupPick?: (text: string) => void;
  /** Side-panel surface uses the smaller user-heading size. */
  compact?: boolean;
}

export function ChatMessageList({ messages, streaming, onFollowupPick, compact }: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever messages grow.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streaming]);

  if (messages.length === 0 && !streaming) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: T.fSans,
          fontSize: 14,
          color: T.n400,
        }}
      >
        Ask anything about your data…
      </div>
    );
  }

  return (
    <div
      style={{
        // Side-panel (compact) owns its own scroll. Main route delegates scroll
        // to the outer page wrapper so the scrollbar sits at the viewport edge.
        ...(compact ? { flex: 1, overflowY: 'auto' as const } : null),
        paddingTop: 12,
        paddingBottom: 8,
      }}
    >
      {messages.map((msg, i) => {
        if (msg.role === 'user') {
          return <UserMessage key={msg.id} text={msg.text} ts={msg.ts} compact={compact} />;
        }
        // Follow-up chips only render on the *last* assistant message and
        // only when nothing is still streaming after it (phase-04 reqs).
        const isLastAssistant =
          i === messages.length - 1 ||
          messages.slice(i + 1).every((m) => m.role === 'assistant' && false);
        const showFollowups = !streaming && isLastAssistant && !!onFollowupPick;
        return (
          <AssistantMessage
            key={msg.id}
            sections={msg.sections}
            ts={msg.ts}
            cacheHit={msg.cacheHit}
            cacheFreshness={msg.cacheFreshness}
            showFollowups={showFollowups}
            onFollowupPick={onFollowupPick}
          />
        );
      })}

      {/* Typing indicator when streaming and no assistant message yet (or mid-stream) */}
      {streaming && <TypingDots />}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
