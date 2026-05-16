import { useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 6px 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-input);
  background: var(--bg-card);
  min-height: 36px;
`;

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: var(--brand-soft);
  border: 1px solid var(--brand);
  color: var(--brand);
  font-size: 12px;
  font-weight: 500;
`;

const ChipRemove = styled.button`
  appearance: none;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
`;

const InlineInput = styled.input`
  flex: 1;
  min-width: 80px;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 13px;
  color: var(--text-primary);
`;

const SuggestList = styled.ul`
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin: 4px 0 0;
  padding: 4px 0;
  list-style: none;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-input);
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
  max-height: 220px;
  overflow-y: auto;
  z-index: 100;
`;

const SuggestItem = styled.li<{ $highlighted: boolean }>`
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  background: ${(p) => (p.$highlighted ? 'var(--bg-muted)' : 'transparent')};
  color: var(--text-primary);

  &:hover {
    background: var(--bg-muted);
  }
`;

const SUGGEST_CAP = 50;

interface TagComboProps {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  error?: string;
  placeholder?: string;
}

/**
 * Tag chip-combo input. Click suggestions or type-and-Enter to add a chip.
 * Duplicates silently rejected. Backspace on empty input removes the last
 * chip. Validation surfacing (case-sensitivity, whitespace-only) lives in
 * `validate()` — the combo accepts free-form, the validator complains later.
 */
export function TagCombo({
  value,
  onChange,
  suggestions,
  error,
  placeholder = 'Type a tag and press Enter…',
}: TagComboProps) {
  const [input, setInput] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = input.trim().toLowerCase();
    const taken = new Set(value);
    const pool = suggestions.filter((s) => !taken.has(s));
    if (!q) return pool.slice(0, SUGGEST_CAP);
    return pool
      .filter((s) => s.toLowerCase().includes(q))
      .slice(0, SUGGEST_CAP);
  }, [input, suggestions, value]);

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) return; // duplicate — silent
    onChange([...value, trimmed]);
    setInput('');
    setHighlighted(0);
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (matches.length > 0 && input.trim().length > 0) {
        addTag(matches[highlighted] ?? input);
      } else {
        addTag(input);
      }
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      removeAt(value.length - 1);
    } else if (e.key === 'Escape') {
      setInput('');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, Math.max(matches.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    }
  }

  const showSuggestions = input.length > 0 && matches.length > 0;

  return (
    <Wrapper>
      <ChipRow onClick={() => inputRef.current?.focus()}>
        {value.map((tag, idx) => (
          <Chip key={`${tag}-${idx}`}>
            {tag}
            <ChipRemove
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={(e) => {
                e.stopPropagation();
                removeAt(idx);
              }}
            >
              ×
            </ChipRemove>
          </Chip>
        ))}
        <InlineInput
          ref={inputRef}
          value={input}
          placeholder={value.length === 0 ? placeholder : ''}
          onChange={(e) => {
            setInput(e.target.value);
            setHighlighted(0);
          }}
          onKeyDown={onKeyDown}
        />
      </ChipRow>

      {showSuggestions && (
        <SuggestList role="listbox">
          {matches.map((s, idx) => (
            <SuggestItem
              key={s}
              role="option"
              aria-selected={idx === highlighted}
              $highlighted={idx === highlighted}
              onMouseEnter={() => setHighlighted(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                addTag(s);
              }}
            >
              {s}
            </SuggestItem>
          ))}
        </SuggestList>
      )}

      {error && <small style={{ color: 'var(--danger)' }}>{error}</small>}
    </Wrapper>
  );
}
