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
}

export type ChatMessage = UserChatMessage | AssistantChatMessage;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ChatMessageListProps {
  messages: ChatMessage[];
  /** If true and last message is assistant, appends TypingDots after it. */
  streaming?: boolean;
}

export function ChatMessageList({ messages, streaming }: ChatMessageListProps) {
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
        flex: 1,
        overflowY: 'auto',
        paddingTop: 12,
        paddingBottom: 8,
      }}
    >
      {messages.map((msg) =>
        msg.role === 'user' ? (
          <UserMessage key={msg.id} text={msg.text} ts={msg.ts} />
        ) : (
          <AssistantMessage key={msg.id} sections={msg.sections} />
        )
      )}

      {/* Typing indicator when streaming and no assistant message yet (or mid-stream) */}
      {streaming && <TypingDots />}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
