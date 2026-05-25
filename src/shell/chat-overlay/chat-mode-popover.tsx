/**
 * Popover content for the chat mode chip. Two-option radio list with the
 * same labels as the Settings → Chat tab so users see one consistent vocab
 * everywhere. Renders a "Reset to default" link when the session value
 * differs from the user pref.
 */

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { Wand2, Zap } from 'lucide-react';
import type { ChatDisambiguationMode } from '../../pages/Settings/use-chat-disambiguation-mode';

interface Props {
  effective: ChatDisambiguationMode;
  userDefault: ChatDisambiguationMode;
  hasOverride: boolean;
  onChoose: (m: ChatDisambiguationMode) => void;
  onReset: () => void;
  onClose: () => void;
}

const Pop = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  width: 280px;
  background: var(--bg-card, white);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md, 6px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  z-index: 50;
  padding: 6px;
  font-family: var(--font-sans);
`;

const Option = styled.button<{ $active: boolean }>`
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  background: ${(p) => (p.$active ? 'var(--brand-soft, rgba(240,90,34,0.08))' : 'transparent')};
  border: none;
  border-radius: 4px;
  text-align: left;
  cursor: pointer;
  color: var(--text-primary);
  &:hover { background: var(--bg-muted); }
`;

const IconWrap = styled.div<{ $active: boolean }>`
  color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-secondary)')};
  flex-shrink: 0;
  margin-top: 2px;
`;

const OptText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Title = styled.div`
  font-size: 13px;
  font-weight: 600;
`;

const Desc = styled.div`
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.4;
`;

const ResetBar = styled.div`
  padding: 6px 10px;
  border-top: 1px solid var(--border-subtle);
  margin-top: 4px;
`;

const ResetLink = styled.button`
  background: none;
  border: none;
  color: var(--brand);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
  &:hover { text-decoration: underline; }
`;

export function ChatModePopover({
  effective,
  userDefault,
  hasOverride,
  onChoose,
  onReset,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const opts: Array<{ value: ChatDisambiguationMode; icon: typeof Wand2; titleKey: string; descKey: string }> = [
    { value: 'targeted', icon: Wand2, titleKey: 'settings.chat.mode.targeted.title', descKey: 'settings.chat.mode.targeted.desc' },
    { value: 'aggressive', icon: Zap, titleKey: 'settings.chat.mode.aggressive.title', descKey: 'settings.chat.mode.aggressive.desc' },
  ];

  return (
    <Pop ref={ref} role="menu" aria-label={t('settings.chat.modeGroup', { defaultValue: 'Disambiguation mode' })}>
      {opts.map((o) => {
        const active = effective === o.value;
        const Ico = o.icon;
        return (
          <Option
            key={o.value}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            $active={active}
            onClick={() => {
              onChoose(o.value);
              onClose();
            }}
          >
            <IconWrap $active={active}>
              <Ico size={16} aria-hidden />
            </IconWrap>
            <OptText>
              <Title>{t(o.titleKey)}</Title>
              <Desc>{t(o.descKey)}</Desc>
            </OptText>
          </Option>
        );
      })}
      {hasOverride && effective !== userDefault ? (
        <ResetBar>
          <ResetLink type="button" onClick={onReset}>
            {t('chat.mode.resetToDefault', { defaultValue: 'Reset to default' })}
          </ResetLink>
        </ResetBar>
      ) : null}
    </Pop>
  );
}
