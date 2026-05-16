import { useMemo, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { Search, Database, Layers, Grid2x2 } from 'lucide-react';
import type { CubeApi } from '@cubejs-client/core';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import { SourceCard } from './source-card';

type TypeFilter = 'all' | 'cube' | 'view';

const pulse = keyframes`
  0%   { box-shadow: 0 0 0 0   rgba(234, 88, 12, 0.45); }
  60%  { box-shadow: 0 0 0 8px rgba(234, 88, 12, 0); }
  100% { box-shadow: 0 0 0 0   rgba(234, 88, 12, 0); }
`;

const Toolbar = styled.div<{ $pulse: boolean }>`
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 16px;
  border-radius: 10px;
  ${(p) =>
    p.$pulse &&
    css`
      animation: ${pulse} 1.4s ease-out;
    `}
`;

const Segmented = styled.div`
  display: inline-flex;
  background: var(--bg-muted);
  border: 1px solid var(--border-card);
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
`;

const SegButton = styled.button<{ $active: boolean }>`
  appearance: none;
  border: none;
  background: transparent;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 120ms, color 120ms;

  &:hover { color: var(--text-primary); }

  ${(p) =>
    p.$active &&
    css`
      background: var(--bg-card);
      color: var(--text-primary);
      box-shadow: var(--shadow-xs);
    `}
`;

const SegCount = styled.span<{ $active: boolean }>`
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 0 5px;
  border-radius: 5px;
  background: ${(p) => (p.$active ? 'var(--bg-muted)' : 'transparent')};
  color: var(--text-muted);
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
  /** Ordered list of selected cube names. `selectedNames[0]` is the primary. */
  selectedNames: string[];
  onToggle: (cubeName: string) => void;
  onSetPrimary: (cubeName: string) => void;
  cubeApi: CubeApi | null;
  /** Pulse the toolbar briefly when set — used when Step 2 sends the user back. */
  highlight?: boolean;
};

export function SourceBody({ cubes, selectedNames, onToggle, onSetPrimary, cubeApi, highlight = false }: SourceBodyProps) {
  const selectedSet = useMemo(() => new Set(selectedNames), [selectedNames]);
  const primaryName = selectedNames[0] ?? null;
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('cube');

  const counts = useMemo(() => {
    let cube = 0;
    let view = 0;
    for (const c of cubes) (c.type === 'view' ? view++ : cube++);
    return { all: cubes.length, cube, view };
  }, [cubes]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cubes.filter((c) => {
      if (typeFilter === 'cube' && c.type === 'view') return false;
      if (typeFilter === 'view' && c.type !== 'view') return false;
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) ||
        (c.title ?? '').toLowerCase().includes(needle) ||
        (c.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [cubes, q, typeFilter]);

  return (
    <>
      <Toolbar $pulse={highlight}>
        <Segmented role="tablist" aria-label="Filter by source type">
          <SegButton
            type="button"
            role="tab"
            aria-selected={typeFilter === 'all'}
            $active={typeFilter === 'all'}
            onClick={() => setTypeFilter('all')}
          >
            <Grid2x2 size={13} />
            All
            <SegCount $active={typeFilter === 'all'}>{counts.all}</SegCount>
          </SegButton>
          <SegButton
            type="button"
            role="tab"
            aria-selected={typeFilter === 'cube'}
            $active={typeFilter === 'cube'}
            onClick={() => setTypeFilter('cube')}
          >
            <Database size={13} />
            Cubes
            <SegCount $active={typeFilter === 'cube'}>{counts.cube}</SegCount>
          </SegButton>
          <SegButton
            type="button"
            role="tab"
            aria-selected={typeFilter === 'view'}
            $active={typeFilter === 'view'}
            onClick={() => setTypeFilter('view')}
          >
            <Layers size={13} />
            Views
            <SegCount $active={typeFilter === 'view'}>{counts.view}</SegCount>
          </SegButton>
        </Segmented>
        <SearchWrap>
          <SearchIcon size={14} />
          <SearchInput
            placeholder="Search cubes & views…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </SearchWrap>
      </Toolbar>
      {visible.length === 0 ? (
        <Empty>
          {q
            ? <>No {typeFilter === 'all' ? 'sources' : typeFilter === 'cube' ? 'cubes' : 'views'} match "{q}".</>
            : <>No {typeFilter === 'cube' ? 'cubes' : 'views'} available.</>}
        </Empty>
      ) : (
        <Grid>
          {visible.map((c) => (
            <SourceCard
              key={c.name}
              cube={c}
              selected={selectedSet.has(c.name)}
              primary={primaryName === c.name}
              onSelect={() => onToggle(c.name)}
              onSetPrimary={() => onSetPrimary(c.name)}
              cubeApi={cubeApi}
            />
          ))}
        </Grid>
      )}
    </>
  );
}
