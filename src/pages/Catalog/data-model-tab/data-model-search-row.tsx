/**
 * DataModelSearchRow — search input + smart-search + result count + view-mode
 * toggle + "New data model" CTA. Mirrors MetricsSearchRow layout so both
 * catalogs share the same toolbar grammar.
 */

import { Plus, Search, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { useSmartSearch } from '../../../shared/smart-search/smart-search-context';
import { ViewModeToggle } from '../../../shared/view-mode/view-mode-toggle';

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-app, transparent);
`;

const SearchBox = styled.div`
  position: relative;
  flex: 1;
  max-width: 480px;
`;

const Input = styled.input`
  width: 100%;
  height: 34px;
  padding: 0 12px 0 32px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 6px;
  background: var(--bg-card, #ffffff);
  font-size: 13px;
  color: var(--text-primary, #171717);

  &:focus {
    outline: none;
    border-color: var(--brand, #f05a22);
  }
`;

const SearchIcon = styled.span`
  position: absolute;
  left: 9px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  color: var(--text-muted, #737373);
`;

const SmartButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
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

const Count = styled.span`
  font-size: 12px;
  color: var(--text-muted, #737373);
  margin-left: auto;
  font-variant-numeric: tabular-nums;
`;

const NewDataModelLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--brand, #f05a22);
  border-radius: 6px;
  background: var(--brand, #f05a22);
  color: white;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;

  &:hover {
    background: var(--brand-pressed, #f54a00);
  }
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
      <SearchBox>
        <SearchIcon>
          <Search size={14} />
        </SearchIcon>
        <Input
          type="search"
          aria-label="Search data model"
          placeholder="Search measures, dimensions, segments…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </SearchBox>
      <SmartButton type="button" title="Open smart search (⌘K)" onClick={open}>
        <Sparkles size={13} />
        Smart search
        <Shortcut>⌘K</Shortcut>
      </SmartButton>
      <Count>
        {visibleCount} of {totalCount}
      </Count>
      <ViewModeToggle module="data-model" />
      <NewDataModelLink to="/data-model/new?v=2">
        <Plus size={13} />
        New data model
      </NewDataModelLink>
    </Row>
  );
}
