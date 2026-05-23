/**
 * DataModelSearchRow — search input + result count. Mirrors metrics-tab's
 * search row visually but talks to ConceptFilters instead of MetricFilters.
 */

import { Sparkles } from 'lucide-react';
import styled from 'styled-components';

import { useSmartSearch } from '../../../shared/smart-search/smart-search-context';

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-card, #ffffff);
`;

const Search = styled.input`
  flex: 1;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg-app, transparent);
  color: var(--text-primary, #171717);

  &:focus {
    outline: none;
    border-color: var(--brand, #f05a22);
  }
`;

const Count = styled.span`
  font-size: 12px;
  color: var(--text-muted, #737373);
  font-variant-numeric: tabular-nums;
`;

const SmartButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #525252);
  font-size: 12px;
  cursor: pointer;

  &:hover {
    border-color: var(--brand, #f05a22);
    color: var(--brand, #f05a22);
  }
`;

const Shortcut = styled.kbd`
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 3px;
  padding: 0 4px;
  color: var(--text-muted, #737373);
`;

interface DataModelSearchRowProps {
  query: string;
  onQueryChange: (q: string) => void;
  visibleCount: number;
  totalCount: number;
}

export function DataModelSearchRow({
  query,
  onQueryChange,
  visibleCount,
  totalCount,
}: DataModelSearchRowProps) {
  const { open } = useSmartSearch();
  return (
    <Row>
      <Search
        type="search"
        placeholder="Search measures, dimensions, segments…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <SmartButton type="button" title="Open smart search (⌘K)" onClick={open}>
        <Sparkles size={13} />
        Smart search
        <Shortcut>⌘K</Shortcut>
      </SmartButton>
      <Count>
        {visibleCount} of {totalCount}
      </Count>
    </Row>
  );
}
