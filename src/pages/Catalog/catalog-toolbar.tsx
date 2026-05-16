import styled from 'styled-components';

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 32px 16px;
  flex-wrap: wrap;
`;

const SearchBox = styled.input`
  flex: 1;
  max-width: 360px;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-input);
  background: var(--bg-card);
  color: var(--text-primary);
  outline: 0;

  &:focus {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px rgba(240, 90, 34, 0.15);
  }
`;

const FacetChip = styled.button<{ $active: boolean }>`
  appearance: none;
  cursor: pointer;
  padding: 6px 12px;
  font-size: 12px;
  border-radius: var(--radius-pill);
  border: 1px solid
    ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-strong)')};
  background: ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-on-brand)' : 'var(--text-secondary)')};

  &:hover {
    background: ${(p) =>
      p.$active ? 'var(--brand-hover)' : 'var(--bg-muted)'};
  }
`;

interface CatalogToolbarProps {
  search: string;
  onSearchChange: (next: string) => void;
  hasPreAggOnly: boolean;
  onHasPreAggToggle: () => void;
}

export function CatalogToolbar({
  search,
  onSearchChange,
  hasPreAggOnly,
  onHasPreAggToggle,
}: CatalogToolbarProps) {
  return (
    <Bar>
      <SearchBox
        type="search"
        placeholder="Search by name, title, or description…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        aria-label="Search catalog"
      />
      <FacetChip
        type="button"
        $active={hasPreAggOnly}
        onClick={onHasPreAggToggle}
        aria-pressed={hasPreAggOnly}
      >
        Pre-aggregated only
      </FacetChip>
    </Bar>
  );
}
