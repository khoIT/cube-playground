/**
 * ChatThreadView — pure presentation component combining the message list
 * with a pinned-bottom composer. Reused by both the full-page route and
 * the side-panel surface.
 */
import React from 'react';
import { T } from '../../../shell/theme';
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
  /** Disambiguation chip click — sends pinText as the next user turn. */
  onDisambigPick?: (pinText: string) => void;
  /** Phase-06: bypass cache toggle state + handler. */
  bypassCache?: boolean;
  onToggleBypassCache?: () => void;
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
  onDisambigPick,
  bypassCache,
  onToggleBypassCache,
}: ChatThreadViewProps) {
  // Compact (side panel) keeps its self-contained scroll + flex-pinned
  // composer. Main route delegates scroll to the page wrapper and uses a
  // sticky composer so the page can scroll while the input stays docked.
  const outerStyle: React.CSSProperties = compact
    ? { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }
    : { display: 'flex', flexDirection: 'column', minHeight: '100%' };

  const composerWrapperStyle: React.CSSProperties = compact
    ? { padding: '8px 12px 12px' }
    : {
        padding: '12px 0 20px',
        position: 'sticky',
        bottom: 0,
        background: T.surface,
        marginTop: 'auto',
      };

  return (
    <div style={outerStyle}>
      {banner}
      <ChatMessageList
        messages={messages}
        streaming={streaming}
        onFollowupPick={onFollowupPick}
        onDisambigPick={onDisambigPick}
        compact={compact}
      />

      <div style={composerWrapperStyle}>
        <ChatComposer
          value={composerValue}
          onChange={onComposerChange}
          onSubmit={onSubmit}
          disabled={streaming}
          compact={compact}
          bypassCache={bypassCache}
          onToggleBypassCache={onToggleBypassCache}
        />
      </div>
    </div>
  );
}
