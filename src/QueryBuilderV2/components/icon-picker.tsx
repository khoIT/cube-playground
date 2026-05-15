import * as LucideIcons from 'lucide-react';
import { useMemo, useState } from 'react';
import styled from 'styled-components';

const NON_ICON_KEYS = new Set([
  'default',
  'createLucideIcon',
  'icons',
  'Icon',
  'LucideIcon',
  'IconNode',
  'LucideProps',
  'LucideIconProps',
]);

const ICON_NAMES: string[] = Object.keys(LucideIcons)
  .filter((k) => /^[A-Z]/.test(k) && !NON_ICON_KEYS.has(k))
  .sort();

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 280px;
`;

const SearchInput = styled.input`
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-input);
  border: 1px solid var(--border-strong);
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-card);

  &:focus {
    outline: none;
    border-color: var(--brand);
    box-shadow: 0 0 0 2px rgba(240, 90, 34, 0.12);
  }
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px 2px;
`;

const Cell = styled.button<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-pill);
  border: 1px solid
    ${(p) => (p.$selected ? 'var(--brand)' : 'transparent')};
  background: ${(p) =>
    p.$selected ? 'var(--brand-soft)' : 'transparent'};
  color: ${(p) => (p.$selected ? 'var(--brand)' : 'var(--text-secondary)')};
  cursor: pointer;

  &:hover {
    background: var(--bg-muted);
    color: var(--text-primary);
  }
`;

const Empty = styled.div`
  padding: 12px 8px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
`;

type IconPickerProps = {
  value?: string;
  onPick: (name: string) => void;
};

const MAX_RESULTS = 60;

export function IconPicker({ value, onPick }: IconPickerProps) {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ICON_NAMES.slice(0, MAX_RESULTS);
    return ICON_NAMES.filter((n) => n.toLowerCase().includes(q)).slice(
      0,
      MAX_RESULTS,
    );
  }, [query]);

  return (
    <Wrap>
      <SearchInput
        autoFocus
        placeholder="Search icons…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length === 0 ? (
        <Empty>No icons match "{query}"</Empty>
      ) : (
        <Grid>
          {matches.map((name) => {
            const Cmp = (LucideIcons as unknown as Record<string, any>)[name];
            if (!Cmp) return null;
            return (
              <Cell
                key={name}
                title={name}
                $selected={value === name}
                onClick={() => onPick(name)}
                type="button"
              >
                <Cmp size={16} strokeWidth={2} />
              </Cell>
            );
          })}
        </Grid>
      )}
    </Wrap>
  );
}

export function getLucideIcon(name?: string) {
  if (!name) return null;
  const Cmp = (LucideIcons as unknown as Record<string, any>)[name];
  return Cmp ?? null;
}
