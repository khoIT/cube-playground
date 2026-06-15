/**
 * MetricsSearchRow — substring search input + result count chip.
 */

import { Search, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { ViewModeToggle } from '../../../shared/view-mode/view-mode-toggle';

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-card);
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
  border: 1px solid var(--border-card);
  border-radius: 6px;
  background: var(--bg-card);
  font-size: 13px;
  color: var(--text-primary);

  &:focus {
    outline: none;
    border-color: var(--brand);
  }
`;

const Icon = styled.span`
  position: absolute;
  left: 9px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  color: var(--text-muted);
`;

const Count = styled.span`
  font-size: 12px;
  color: var(--text-muted);
  margin-left: auto;
`;

const NewMetricLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--brand);
  border-radius: 6px;
  background: var(--brand);
  color: white;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;

  &:hover { background: var(--brand-hover); }
`;

interface MetricsSearchRowProps {
  query: string;
  onQueryChange: (q: string) => void;
  visibleCount: number;
  availableCount: number;
  totalCount: number;
  activeGameLabel: string;
}

export function MetricsSearchRow({
  query,
  onQueryChange,
  visibleCount,
  availableCount,
  totalCount,
  activeGameLabel,
}: MetricsSearchRowProps) {
  return (
    <Row>
      <SearchBox>
        <Icon>
          <Search size={14} />
        </Icon>
        <Input
          aria-label="Search metrics"
          placeholder="Search metrics by name or synonym…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </SearchBox>
      <Count>
        {visibleCount} shown · {availableCount} of {totalCount} available for {activeGameLabel}
      </Count>
      <ViewModeToggle module="metrics-catalog" />
      <NewMetricLink to="/data-model/new?v=2">
        <Plus size={13} />
        New metric
      </NewMetricLink>
    </Row>
  );
}
