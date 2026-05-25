/**
 * Accessible radio group for picking the default chat disambiguation mode.
 * Renders two large cards (title + description) instead of bare radio dots
 * so the trade-off between modes is obvious at a glance.
 */

import React, { KeyboardEvent } from 'react';
import styled from 'styled-components';
import type { ChatDisambiguationMode } from './use-chat-disambiguation-mode';

interface Option {
  value: ChatDisambiguationMode;
  title: string;
  description: string;
}

interface Props {
  value: ChatDisambiguationMode;
  onChange: (next: ChatDisambiguationMode) => void;
  options: Option[];
  groupLabel?: string;
}

const Group = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.button<{ $active: boolean }>`
  text-align: left;
  border: 1px solid ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-card)')};
  background: ${(p) => (p.$active ? 'var(--brand-soft, rgba(240,90,34,0.06))' : 'var(--bg-card)')};
  color: var(--text-primary);
  border-radius: var(--radius-md, 6px);
  padding: 14px 16px;
  cursor: pointer;
  font-family: var(--font-sans);
  transition: border-color 120ms ease, background 120ms ease;
  display: flex;
  flex-direction: column;
  gap: 6px;

  &:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
`;

const Title = styled.div`
  font-size: 14px;
  font-weight: 600;
`;

const Description = styled.div`
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
`;

export function ChatModeRadioGroup({ value, onChange, options, groupLabel }: Props) {
  function move(currentIdx: number, delta: number) {
    const next = (currentIdx + delta + options.length) % options.length;
    onChange(options[next].value);
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>, idx: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(idx, 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(idx, -1);
    }
  }
  return (
    <Group role="radiogroup" aria-label={groupLabel} onKeyDown={(e) => onKey(e, options.findIndex((o) => o.value === value))}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Card
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            $active={active}
            onClick={() => onChange(opt.value)}
          >
            <Title>{opt.title}</Title>
            <Description>{opt.description}</Description>
          </Card>
        );
      })}
    </Group>
  );
}
