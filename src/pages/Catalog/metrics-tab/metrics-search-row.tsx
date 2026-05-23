/**
 * MetricsSearchRow — substring search input + result count chip + smart-search
 * stub. The smart-search button is rendered disabled until P7.
 */

import { Search, Sparkles } from 'lucide-react';
import styled from 'styled-components';

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

const Icon = styled.span`
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
  border: 1px dashed var(--border-card, #e5e5e5);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted, #737373);
  font-size: 12px;
  cursor: not-allowed;
`;

const Count = styled.span`
  font-size: 12px;
  color: var(--text-muted, #737373);
  margin-left: auto;
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
      <SmartButton type="button" title="Smart search — coming in Phase 7" disabled>
        <Sparkles size={13} />
        Smart search
      </SmartButton>
      <Count>
        {visibleCount} shown · {availableCount} of {totalCount} available for {activeGameLabel}
      </Count>
    </Row>
  );
}
