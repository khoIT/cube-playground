/**
 * ChatThreadView — pure presentation component combining the message list
 * with a pinned-bottom composer. Reused by both the full-page route and
 * the side-panel surface.
 */
import React from 'react';
import { Link } from 'react-router-dom';
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
  /** Web search toggle: when ON, sends X-Web-Search: 1 per turn. */
  webSearch?: boolean;
  onToggleWebSearch?: () => void;
  /** Research mode toggle: when ON, sends X-Research-Mode: 1 per turn (extended timeout). */
  researchMode?: boolean;
  onToggleResearchMode?: () => void;
  /** When true the session is shared and caller is NOT the owner — hide the
   *  composer and show a read-only footer notice instead. */
  readOnly?: boolean;
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
  webSearch,
  onToggleWebSearch,
  researchMode,
  onToggleResearchMode,
  readOnly,
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

      {readOnly ? (
        /* Read-only shared view: replace composer with a muted notice. */
        <div
          style={{
            padding: compact ? '8px 12px 12px' : '12px 0 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            color: 'var(--text-muted)',
          }}
        >
          <span>Shared chat — read-only. Start your own chat to ask follow-ups.</span>
          <Link
            to="/chat"
            style={{
              fontSize: 12,
              color: 'var(--brand)',
              textDecoration: 'none',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            New chat
          </Link>
        </div>
      ) : (
        <div style={composerWrapperStyle}>
          <ChatComposer
            value={composerValue}
            onChange={onComposerChange}
            onSubmit={onSubmit}
            disabled={streaming}
            compact={compact}
            bypassCache={bypassCache}
            onToggleBypassCache={onToggleBypassCache}
            webSearch={webSearch}
            onToggleWebSearch={onToggleWebSearch}
            deepResearch={researchMode}
            onToggleDeepResearch={onToggleResearchMode}
          />
        </div>
      )}
    </div>
  );
}
