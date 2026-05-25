/**
 * ChatServiceCacheControls — bypass-cache toggle + clear-cache-for-game button.
 *
 * Clear is game-scoped (shared cache) so the confirm dialog makes the
 * scope explicit. Result is shown inline as a transient status message.
 */

import React, { useState } from 'react';
import styled from 'styled-components';
import { getOwnerId } from '../../../api/chat-owner-id';

interface ChatServiceCacheControlsProps {
  bypassCache: boolean;
  onBypassChange: (value: boolean) => void;
  /** Active game id used as ?game= param. Button disabled when null. */
  gameId: string | null;
}

// ---------------------------------------------------------------------------
// Styled primitives
// ---------------------------------------------------------------------------

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-card);

  &:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
`;

const RowLabel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const RowTitle = styled.span`
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-primary);
`;

const RowHint = styled.span`
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.4;
`;

const Toggle = styled.button<{ $on: boolean }>`
  flex-shrink: 0;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: none;
  background: ${(p) => (p.$on ? 'var(--brand)' : 'var(--border-strong)')};
  cursor: pointer;
  position: relative;
  transition: background-color 150ms ease;

  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: ${(p) => (p.$on ? '21px' : '3px')};
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    transition: left 150ms ease;
  }

  &:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
`;

const DangerButton = styled.button`
  flex-shrink: 0;
  height: 30px;
  padding: 0 14px;
  background: transparent;
  border: 1px solid var(--red-500, #ef4444);
  border-radius: var(--radius-pill);
  color: var(--red-500, #ef4444);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;

  &:hover:not(:disabled) {
    background: var(--red-50, #fef2f2);
  }
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  &:focus-visible {
    outline: 2px solid var(--red-500, #ef4444);
    outline-offset: 1px;
  }
`;

const StatusMsg = styled.span<{ $error?: boolean }>`
  font-size: 11.5px;
  color: ${(p) => (p.$error ? 'var(--red-500, #ef4444)' : 'var(--text-muted)')};
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ClearStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; deleted: number }
  | { kind: 'error'; message: string };

export function ChatServiceCacheControls({
  bypassCache,
  onBypassChange,
  gameId,
}: ChatServiceCacheControlsProps) {
  const [clearStatus, setClearStatus] = useState<ClearStatus>({ kind: 'idle' });

  async function handleClearCache() {
    if (!gameId) return;
    const confirmed = window.confirm(
      `Clear response cache for game "${gameId}"?\n\nThis removes ALL cached responses for this game and affects every user of it. Their next identical query will make a fresh LLM call.`,
    );
    if (!confirmed) return;

    setClearStatus({ kind: 'pending' });
    try {
      const res = await fetch(
        `/api/chat/debug/cache?game=${encodeURIComponent(gameId)}`,
        {
          method: 'DELETE',
          headers: { 'X-Owner-Id': getOwnerId() },
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setClearStatus({ kind: 'error', message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      const data = await res.json() as { deleted: number };
      setClearStatus({ kind: 'success', deleted: data.deleted });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      console.error('[chat-service-cache-controls] clear cache failed:', err);
      setClearStatus({ kind: 'error', message: msg });
    }
  }

  return (
    <>
      {/* Bypass cache toggle */}
      <Row>
        <RowLabel>
          <RowTitle>Bypass response cache</RowTitle>
          <RowHint>
            Sends X-Bypass-Cache: 1 on every /turn — forces a fresh LLM call even when a
            cached response exists. Useful for testing. Skips both cache read and write.
          </RowHint>
        </RowLabel>
        <Toggle
          $on={bypassCache}
          type="button"
          role="switch"
          aria-checked={bypassCache}
          aria-label="Bypass response cache"
          onClick={() => onBypassChange(!bypassCache)}
        />
      </Row>

      {/* Clear cache for game */}
      <Row>
        <RowLabel>
          <RowTitle>Clear cache for current game</RowTitle>
          <RowHint>
            {gameId
              ? `Deletes all cached responses for game "${gameId}". Affects all users of this game.`
              : 'Navigate to a game first to enable this action.'}
          </RowHint>
          {clearStatus.kind === 'success' && (
            <StatusMsg>Cleared {clearStatus.deleted} cached response{clearStatus.deleted !== 1 ? 's' : ''}.</StatusMsg>
          )}
          {clearStatus.kind === 'error' && (
            <StatusMsg $error>Error: {clearStatus.message}</StatusMsg>
          )}
        </RowLabel>
        <DangerButton
          type="button"
          disabled={!gameId || clearStatus.kind === 'pending'}
          onClick={handleClearCache}
        >
          {clearStatus.kind === 'pending' ? 'Clearing…' : 'Clear cache'}
        </DangerButton>
      </Row>
    </>
  );
}

