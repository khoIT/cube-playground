import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { Search } from 'lucide-react';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import { SourceCard } from './source-card';

const FilterBar = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 16px;
`;

const SearchWrap = styled.div`
  position: relative;
  flex: 1;
`;

const SearchInput = styled.input`
  width: 100%;
  height: 36px;
  padding: 0 12px 0 32px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  font-size: 13.5px;
  &:focus { border-color: var(--brand); outline: none; }
`;

const SearchIcon = styled(Search)`
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
`;

const Empty = styled.div`
  text-align: center;
  padding: 32px;
  color: var(--text-muted);
  font-size: 13px;
`;

export type SourceBodyProps = {
  cubes: WizardCube[];
  selectedName: string | null;
  onSelect: (cubeName: string) => void;
};

export function SourceBody({ cubes, selectedName, onSelect }: SourceBodyProps) {
  const [q, setQ] = useState('');

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return cubes;
    return cubes.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (c.title ?? '').toLowerCase().includes(needle) ||
        (c.description ?? '').toLowerCase().includes(needle)
    );
  }, [cubes, q]);

  return (
    <>
      <FilterBar>
        <SearchWrap>
          <SearchIcon size={14} />
          <SearchInput
            placeholder="Search cubes & views…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </SearchWrap>
      </FilterBar>
      {visible.length === 0 ? (
        <Empty>No cubes match "{q}".</Empty>
      ) : (
        <Grid>
          {visible.map((c) => (
            <SourceCard
              key={c.name}
              cube={c}
              selected={selectedName === c.name}
              onSelect={() => onSelect(c.name)}
            />
          ))}
        </Grid>
      )}
    </>
  );
}
