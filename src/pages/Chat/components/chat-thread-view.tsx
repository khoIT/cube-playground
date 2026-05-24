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
  /** Optional banner rendered above the message list (e.g. disconnect notice). */
  banner?: React.ReactNode;
  /** Phase-04: pre-fill + submit the given text (follow-up chip click). */
  onFollowupPick?: (text: string) => void;
}

export function ChatThreadView({
  messages,
  streaming,
  composerValue,
  onComposerChange,
  onSubmit,
  compact,
  banner,
  onFollowupPick,
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
      {banner}
      <ChatMessageList
        messages={messages}
        streaming={streaming}
        onFollowupPick={onFollowupPick}
        compact={compact}
      />

      <div style={{ padding: compact ? '8px 12px 12px' : '12px 0 20px' }}>
        <ChatComposer
          value={composerValue}
          onChange={onComposerChange}
          onSubmit={onSubmit}
          disabled={streaming}
          compact={compact}
        />
      </div>
    </div>
  );
}
