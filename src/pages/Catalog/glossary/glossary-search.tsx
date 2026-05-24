/**
 * Search + category filter for the glossary index page.
 */
import React from 'react';
import styled from 'styled-components';

const Bar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
`;

const Input = styled.input`
  flex: 1;
  min-width: 240px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  outline: none;
`;

const Chip = styled.button<{ $active: boolean }>`
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid ${(p) => (p.$active ? 'var(--brand, #f05a22)' : 'var(--border)')};
  background: ${(p) => (p.$active ? 'var(--brand, #f05a22)' : 'transparent')};
  color: ${(p) => (p.$active ? '#fff' : 'var(--text-secondary)')};
  font-size: 12px;
  cursor: pointer;
`;

interface Props {
  query: string;
  onQueryChange: (next: string) => void;
  category: string | null;
  onCategoryChange: (next: string | null) => void;
  categories: ReadonlyArray<string>;
}

export function GlossarySearch({ query, onQueryChange, category, onCategoryChange, categories }: Props) {
  return (
    <Bar>
      <Input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Filter terms…"
        aria-label="Filter glossary terms"
      />
      <Chip type="button" $active={category === null} onClick={() => onCategoryChange(null)}>
        All
      </Chip>
      {categories.map((c) => (
        <Chip
          key={c}
          type="button"
          $active={category === c}
          onClick={() => onCategoryChange(c)}
        >
          {c}
        </Chip>
      ))}
    </Bar>
  );
}
