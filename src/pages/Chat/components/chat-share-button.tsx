/**
 * ChatShareButton — compact owner-only toggle for publishing a chat session
 * to the team. Rendered in the chat-thread-page header row alongside
 * ChatModeChip and ChatHeaderFocusChip.
 *
 * Props:
 *   sessionId — the session to share/unshare
 *   shared    — current visibility ('shared' → true)
 *   onChanged — called after a successful toggle so the parent can refetch
 *
 * Visual parity: height-24 pill, same as ChatModeChip / ChatHeaderFocusChip.
 * Tokens only — no raw hex.
 */
import React, { useState } from 'react';
import styled from 'styled-components';
import { Users } from 'lucide-react';
import { setChatSessionShared } from '../../../api/chat-sessions-client';

interface ChatShareButtonProps {
  sessionId: string;
  shared: boolean;
  onChanged: () => void;
}

const Chip = styled.button<{ $shared: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid ${(p) => (p.$shared ? 'var(--success-ink)' : 'var(--border-card)')};
  background: ${(p) => (p.$shared ? 'var(--success-soft)' : 'transparent')};
  color: ${(p) => (p.$shared ? 'var(--success-ink)' : 'var(--text-secondary)')};
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;
  transition: background 0.12s, border-color 0.12s;

  &:hover:not(:disabled) {
    background: var(--bg-muted);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

export function ChatShareButton({ sessionId, shared, onChanged }: ChatShareButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setChatSessionShared(sessionId, !shared);
      onChanged();
    } catch (err) {
      // Surface to console; not worth a full error banner for a toggle failure.
      console.error('[ChatShareButton] toggle failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const label = shared ? 'Shared with team' : 'Share with team';
  const title = shared
    ? 'Click to make this conversation private again'
    : 'Publish this conversation so your team can view it read-only';

  return (
    <Chip
      type="button"
      $shared={shared}
      onClick={handleClick}
      disabled={busy}
      title={title}
      aria-pressed={shared}
      data-testid="chat-share-button"
    >
      <Users size={12} aria-hidden />
      <span>{busy ? (shared ? 'Unsharing…' : 'Sharing…') : label}</span>
    </Chip>
  );
}
