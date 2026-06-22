/**
 * Width toggle chip for the full-page /chat header. Flips the chat column
 * between a focused 70% reading width and full width so wide chart artifacts
 * can be viewed without horizontal cramping. Mirrors ChatModeChip's styling.
 *
 * Rendered only by ChatThreadPage (the full page); the docked right panel is a
 * separate component and never mounts this, so it auto-hides when chat is the
 * right pane.
 */
import React from 'react';
import styled from 'styled-components';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useChatMainWidthFull } from './use-chat-main-width';

const Chip = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-card)')};
  background: ${(p) => (p.$active ? 'var(--brand-soft, rgba(240,90,34,0.08))' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-secondary)')};
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

interface Props {
  /** Hide the text label, keeping the icon only (narrow headers). */
  hideLabel?: boolean;
}

export function ChatWidthToggle({ hideLabel }: Props) {
  const [isFull, toggle] = useChatMainWidthFull();
  const Icon = isFull ? Minimize2 : Maximize2;
  const title = isFull ? 'Shrink to 70% width' : 'Expand to full width';
  return (
    <Chip
      type="button"
      $active={isFull}
      title={title}
      aria-pressed={isFull}
      onClick={toggle}
    >
      <Icon size={12} aria-hidden />
      {hideLabel ? null : <Label>{isFull ? 'Full' : '70%'}</Label>}
    </Chip>
  );
}
