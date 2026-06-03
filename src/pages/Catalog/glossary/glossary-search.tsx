/**
 * Free-text search box for the glossary index page. The category / status /
 * wiring facets live in GlossaryFilterBar; this stays a single-purpose input.
 */
import React from 'react';
import styled from 'styled-components';

const Input = styled.input`
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-card);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  outline: none;

  &:focus {
    border-color: var(--brand);
  }
`;

interface Props {
  query: string;
  onQueryChange: (next: string) => void;
  placeholder?: string;
}

export function GlossarySearch({ query, onQueryChange, placeholder }: Props) {
  return (
    <Input
      type="search"
      value={query}
      onChange={(e) => onQueryChange(e.target.value)}
      placeholder={placeholder ?? 'Filter terms…'}
      aria-label="Filter glossary terms"
    />
  );
}
