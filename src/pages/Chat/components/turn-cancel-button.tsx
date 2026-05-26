/**
 * Phase 04 — "Stop generating" button. Renders inline below the streaming
 * assistant message while the turn is in flight. Click → POST cancel +
 * abort the local fetch.
 *
 * Visibility: only mounted when `isStreaming && turnId != null`. The button
 * stays mounted briefly after the cancel call so users see the press confirm
 * via the busy state; the parent unmounts on `aborted`/`done`.
 *
 * Token compliance: uses the same chip aesthetic as DisambigModeChip /
 * ChatModeChip — rounded pill, brand-soft fill, design-token borders.
 */
import { Square } from 'lucide-react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

interface Props {
  turnId: string | null;
  isStreaming: boolean;
  onCancel: () => void | Promise<unknown>;
  busy: boolean;
}

const Btn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;

  &:hover,
  &:focus-visible {
    color: var(--destructive-ink);
    border-color: var(--destructive-ink);
    background: var(--destructive-soft);
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

export function TurnCancelButton({ turnId, isStreaming, onCancel, busy }: Props) {
  const { t } = useTranslation();
  if (!isStreaming || !turnId) return null;
  return (
    <Btn
      type="button"
      onClick={() => { void onCancel(); }}
      disabled={busy}
      aria-label={t('chat.cancelTurn.aria', { defaultValue: 'Stop generating' })}
      data-testid="turn-cancel-button"
      title={t('chat.cancelTurn.title', { defaultValue: 'Stop generating' })}
    >
      <Square size={12} strokeWidth={2.5} aria-hidden />
      {busy
        ? t('chat.cancelTurn.busy', { defaultValue: 'Stopping…' })
        : t('chat.cancelTurn.label', { defaultValue: 'Stop generating' })}
    </Btn>
  );
}
