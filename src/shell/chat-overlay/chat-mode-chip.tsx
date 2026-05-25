/**
 * Compact mode chip rendered in the chat panel header. Shows the effective
 * mode (per-session override falls back to the user pref) and opens a small
 * popover for switching. Label hides on narrow panels to keep the header
 * single-line on small viewports.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { Wand2, Zap } from 'lucide-react';
import {
  useChatDisambiguationMode,
  type ChatDisambiguationMode,
} from '../../pages/Settings/use-chat-disambiguation-mode';
import { useSessionModeOverride } from './use-session-mode-override';
import { ChatModePopover } from './chat-mode-popover';

interface Props {
  sessionId: string | null;
  hideLabel?: boolean;
}

const Wrap = styled.div`
  position: relative;
  display: inline-flex;
`;

const Chip = styled.button<{ $aggressive: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid ${(p) => (p.$aggressive ? 'var(--brand)' : 'var(--border-card)')};
  background: ${(p) => (p.$aggressive ? 'var(--brand-soft, rgba(240,90,34,0.08))' : 'transparent')};
  color: ${(p) => (p.$aggressive ? 'var(--brand)' : 'var(--text-secondary)')};
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  &:hover { background: var(--bg-muted); }
`;

const Label = styled.span`
  white-space: nowrap;
`;

export function ChatModeChip({ sessionId, hideLabel }: Props) {
  const { t } = useTranslation();
  const { mode: userDefault } = useChatDisambiguationMode();
  const { override, effective, setOverride, clear } = useSessionModeOverride(sessionId);
  const [open, setOpen] = useState(false);

  const aggressive = effective === 'aggressive';
  const Icon = aggressive ? Zap : Wand2;
  const labelText = aggressive
    ? t('chat.mode.chip.aggressive', { defaultValue: 'Aggressive' })
    : t('chat.mode.chip.targeted', { defaultValue: 'Targeted' });

  function onChoose(next: ChatDisambiguationMode) {
    if (next === userDefault) {
      clear();
    } else {
      setOverride(next);
    }
  }

  return (
    <Wrap>
      <Chip
        type="button"
        $aggressive={aggressive}
        aria-haspopup="menu"
        aria-expanded={open}
        title={labelText}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={12} aria-hidden />
        {hideLabel ? null : <Label>{labelText}</Label>}
      </Chip>
      {open ? (
        <ChatModePopover
          effective={effective}
          userDefault={userDefault}
          hasOverride={!!override}
          onChoose={onChoose}
          onReset={() => {
            clear();
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Wrap>
  );
}
