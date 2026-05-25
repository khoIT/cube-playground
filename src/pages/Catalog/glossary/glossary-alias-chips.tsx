/**
 * Chip input for alias lists. Used for both English and Vietnamese aliases.
 * Comma or Enter commits the typed value; Backspace on an empty input pops
 * the last chip so users can erase by feel without reaching for the mouse.
 */

import React, { KeyboardEvent, useState } from 'react';
import styled from 'styled-components';
import { X as XIcon } from 'lucide-react';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  maxItems?: number;
  ariaLabel?: string;
}

const Wrap = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 8px;
  min-height: 36px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-input, var(--bg-app));
  font-family: var(--font-sans);
  &:focus-within {
    border-color: var(--brand);
  }
`;

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-muted);
  font-size: 12px;
  color: var(--text-primary);
`;

const ChipClose = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 0;
  &:hover { color: var(--text-primary); }
`;

const Field = styled.input`
  flex: 1;
  min-width: 80px;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--text-primary);
`;

function clean(token: string): string {
  return token.replace(/[\r\n]+/g, ' ').trim().slice(0, 40);
}

export function GlossaryAliasChips({
  value,
  onChange,
  placeholder,
  maxItems = 20,
  ariaLabel,
}: Props) {
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    const token = clean(raw);
    if (!token) return;
    if (value.includes(token)) {
      setDraft('');
      return;
    }
    if (value.length >= maxItems) return;
    onChange([...value, token]);
    setDraft('');
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      removeAt(value.length - 1);
    }
  }

  return (
    <Wrap aria-label={ariaLabel}>
      {value.map((alias, idx) => (
        <Chip key={`${alias}-${idx}`}>
          {alias}
          <ChipClose
            type="button"
            onClick={() => removeAt(idx)}
            aria-label={`Remove ${alias}`}
          >
            <XIcon size={12} aria-hidden />
          </ChipClose>
        </Chip>
      ))}
      <Field
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => commit(draft)}
        placeholder={placeholder}
      />
    </Wrap>
  );
}
