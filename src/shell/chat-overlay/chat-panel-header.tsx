/**
 * ChatPanelHeader — 44px fixed header bar for the side chat panel.
 * Shows title (links to full session page on expand), New button, and Close X.
 */
import React from 'react';
import { Plus, X } from 'lucide-react';
import { T, Icon } from '../theme';

interface ChatPanelHeaderProps {
  sessionId: string | null;
  sessionTitle?: string;
  onClose: () => void;
  onNew: () => void;
  onExpand: () => void;
}

const MAX_TITLE_CHARS = 32;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function ChatPanelHeader({
  sessionId,
  sessionTitle,
  onClose,
  onNew,
  onExpand,
}: ChatPanelHeaderProps) {
  const displayTitle = sessionId && sessionTitle
    ? truncate(sessionTitle, MAX_TITLE_CHARS)
    : 'Ask Cube';

  return (
    <div
      data-testid="chat-panel-header"
      style={{
        height: 44,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px 0 14px',
        borderBottom: `1px solid ${T.n200}`,
        gap: 4,
      }}
    >
      {/* Title — clickable to expand to full page */}
      <button
        type="button"
        onClick={onExpand}
        title={sessionId ? 'Open full page' : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
          background: 'none',
          border: 'none',
          padding: '0 4px',
          cursor: sessionId ? 'pointer' : 'default',
          fontFamily: T.fSans,
          fontWeight: 600,
          fontSize: 13,
          color: T.n900,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {displayTitle}
      </button>

      {/* New chat button */}
      <button
        type="button"
        onClick={onNew}
        aria-label="New chat"
        title="New chat"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: 8,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: T.n600,
          flexShrink: 0,
        }}
      >
        <Icon icon={Plus} size={16} />
      </button>

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close chat panel"
        title="Close"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: 8,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: T.n600,
          flexShrink: 0,
        }}
      >
        <Icon icon={X} size={16} />
      </button>
    </div>
  );
}
