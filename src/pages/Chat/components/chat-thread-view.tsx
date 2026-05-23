/**
 * ChatThreadView — pure presentation component combining the message list
 * with a pinned-bottom composer. Reused by both the full-page route and
 * the side-panel surface.
 */
import React from 'react';
import { ChatMessageList, type ChatMessage } from './chat-message-list';
import { ChatComposer } from './chat-composer';

interface ChatThreadViewProps {
  messages: ChatMessage[];
  streaming?: boolean;
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSubmit: () => void;
  compact?: boolean;
}

export function ChatThreadView({
  messages,
  streaming,
  composerValue,
  onComposerChange,
  onSubmit,
  compact,
}: ChatThreadViewProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <ChatMessageList messages={messages} streaming={streaming} />

      <ChatComposer
        value={composerValue}
        onChange={onComposerChange}
        onSubmit={onSubmit}
        disabled={streaming}
        compact={compact}
      />
    </div>
  );
}
