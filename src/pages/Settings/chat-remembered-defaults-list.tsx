/**
 * Settings → Chat "Remembered defaults" — list of cross-session slot
 * resolutions the disambiguator has learned, with per-row delete and a
 * clear-all action. Reads tokens from `src/theme/tokens.css` so it stays
 * visually consistent with the rest of Settings + the chat surface.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { X, Trash2 } from 'lucide-react';
import { useChatRememberedDefaults } from './use-chat-remembered-defaults';
import type { RememberedDefaultRow } from '../../api/chat-user-prefs-client';

const ListWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 140px 1fr auto auto;
  align-items: center;
  gap: 16px;
  padding: 10px 12px;
  background: var(--bg-muted);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: 13px;
`;

const SlotLabel = styled.span`
  color: var(--text-secondary);
  font-weight: 500;
`;

const ValueLabel = styled.span`
  color: var(--text-primary);
`;

const TimeMeta = styled.span`
  color: var(--text-muted);
  font-size: 12px;
`;

const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  color: var(--text-muted);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;

  &:hover,
  &:focus-visible {
    color: var(--destructive-ink);
    background: var(--destructive-soft);
    border-color: var(--destructive-ink);
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const ClearAllButton = styled.button`
  align-self: flex-start;
  margin-top: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  background: var(--destructive-soft);
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  color: var(--destructive-ink);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;

  &:hover,
  &:focus-visible { border-color: var(--destructive-ink); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const EmptyState = styled.p`
  margin: 0;
  padding: 14px 0;
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 13px;
  text-align: center;
`;

function slotKey(slot: string): string {
  if (slot.startsWith('filter:')) return 'filter';
  if (slot === 'metric' || slot === 'dimension' || slot === 'timeRange') return slot;
  return 'metric';
}

function formatRelative(ts: number, now: number = Date.now()): string {
  const diffMs = now - ts;
  const sec = Math.max(1, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

interface RowProps {
  row: RememberedDefaultRow;
  onRemove: (slot: string) => void;
  busy: boolean;
}

function DefaultRow({ row, onRemove, busy }: RowProps): React.ReactElement {
  const { t } = useTranslation();
  const key = slotKey(row.slot);
  const memberName = row.slot.startsWith('filter:') ? row.slot.slice('filter:'.length) : undefined;
  const slotText = t(`settings.chat.rememberedDefaults.slot.${key}`, {
    defaultValue: key === 'filter' ? `Filter (${memberName})` : key,
    member: memberName,
  });
  return (
    <Row data-testid="remembered-default-row" data-slot={row.slot}>
      <SlotLabel>{slotText}</SlotLabel>
      <ValueLabel>{row.label}</ValueLabel>
      <TimeMeta>{t('settings.chat.rememberedDefaults.lastUsed', {
        defaultValue: 'last used {{when}}',
        when: formatRelative(row.lastUsedAt),
      })}</TimeMeta>
      <IconButton
        type="button"
        aria-label={`Remove ${slotText}`}
        disabled={busy}
        onClick={() => onRemove(row.slot)}
      >
        <X size={14} strokeWidth={2} />
      </IconButton>
    </Row>
  );
}

export function ChatRememberedDefaultsList(): React.ReactElement {
  const { t } = useTranslation();
  const { rows, loading, removeOne, removeAll } = useChatRememberedDefaults();
  const [busy, setBusy] = React.useState<boolean>(false);

  const handleRemoveOne = async (slot: string) => {
    setBusy(true);
    try { await removeOne(slot); } finally { setBusy(false); }
  };

  const handleClearAll = async () => {
    const ok = window.confirm(
      t('settings.chat.rememberedDefaults.clearAllConfirm', {
        defaultValue: 'Clear every remembered default for this game?',
      }),
    );
    if (!ok) return;
    setBusy(true);
    try { await removeAll(); } finally { setBusy(false); }
  };

  if (loading) {
    return <EmptyState data-testid="remembered-defaults-loading">{t('common.loading', { defaultValue: 'Loading…' })}</EmptyState>;
  }
  if (rows.length === 0) {
    return (
      <EmptyState data-testid="remembered-defaults-empty">
        {t('settings.chat.rememberedDefaults.empty', {
          defaultValue: 'No remembered defaults yet. The chat assistant will learn as you confirm choices in chat.',
        })}
      </EmptyState>
    );
  }
  return (
    <div>
      <ListWrap>
        {rows.map((r) => (
          <DefaultRow key={r.slot} row={r} onRemove={handleRemoveOne} busy={busy} />
        ))}
      </ListWrap>
      <ClearAllButton
        type="button"
        disabled={busy}
        onClick={handleClearAll}
        data-testid="remembered-defaults-clear-all"
      >
        <Trash2 size={13} strokeWidth={2} />
        {t('settings.chat.rememberedDefaults.clearAll', { defaultValue: 'Clear all remembered defaults' })}
      </ClearAllButton>
    </div>
  );
}
