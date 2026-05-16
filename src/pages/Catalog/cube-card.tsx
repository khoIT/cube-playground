import { useState } from 'react';
import styled from 'styled-components';
import { CatalogCube } from './use-catalog-meta';

const Card = styled.button<{ $selected: boolean }>`
  appearance: none;
  text-align: left;
  cursor: pointer;
  background: var(--bg-card);
  border: 1px solid
    ${(p) => (p.$selected ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: var(--radius-card);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: ${(p) => (p.$selected ? 'var(--shadow-sm)' : 'none')};

  &:hover {
    border-color: var(--brand);
  }
`;

const Header = styled.div`
  display: flex;
  align-items: baseline;
  gap: 6px;
`;

const Name = styled.div`
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 600;
`;

const TypeTag = styled.span`
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--bg-muted);
  color: var(--text-muted);
  text-transform: uppercase;
`;

const Title = styled.div`
  font-size: 13px;
  color: var(--text-secondary);
`;

const Description = styled.div`
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.45;
`;

const ReadMore = styled.span`
  margin-left: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--brand);
  cursor: pointer;
  &:hover { text-decoration: underline; }
`;

const Stats = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-muted);
`;

const Stat = styled.span`
  background: var(--bg-muted);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
`;

function firstSentence(text: string): { head: string; rest: string } {
  const m = text.match(/^([\s\S]*?[.!?])(\s+|$)/);
  if (!m) return { head: text, rest: '' };
  return { head: m[1], rest: text.slice(m[0].length).trim() };
}

// Title convention: "Ballistar VN — Daily Active Snapshot" — game label
// lives before the em-dash (or hyphen). Falls back to the full title when
// no separator is present.
function gameLabelFromTitle(title: string | undefined): string | null {
  if (!title) return null;
  const em = title.indexOf(' — ');
  if (em > 0) return title.slice(0, em).trim();
  const hy = title.indexOf(' - ');
  if (hy > 0) return title.slice(0, hy).trim();
  return title.trim();
}

interface CubeCardProps {
  cube: CatalogCube;
  selected: boolean;
  onClick: () => void;
}

export function CubeCard({ cube, selected, onClick }: CubeCardProps) {
  const measureCount = cube.measures?.length ?? 0;
  const dimensionCount = cube.dimensions?.length ?? 0;
  const joinCount = cube.joins?.length ?? 0;
  const hasRollups = (cube.preAggregations?.length ?? 0) > 0;

  const [expanded, setExpanded] = useState(false);
  const desc = cube.description?.trim() ?? '';
  const { head, rest } = firstSentence(desc);

  return (
    <Card $selected={selected} type="button" onClick={onClick}>
      <Header>
        <Name>{cube.name}</Name>
        <TypeTag>{cube.type ?? 'cube'}</TypeTag>
      </Header>
      {gameLabelFromTitle(cube.title) && (
        <Title data-testid="cube-card-game-label">{gameLabelFromTitle(cube.title)}</Title>
      )}
      {desc && (
        <Description data-testid="cube-card-description">
          {expanded || !rest ? desc : head}
          {rest && (
            <ReadMore
              role="button"
              data-testid="cube-card-more"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              {expanded ? 'Less' : 'More'}
            </ReadMore>
          )}
        </Description>
      )}
      <Stats>
        <Stat>{measureCount} measures</Stat>
        <Stat>{dimensionCount} dimensions</Stat>
        {joinCount > 0 && <Stat>{joinCount} joins</Stat>}
        {hasRollups && <Stat>Rollup × {cube.preAggregations!.length}</Stat>}
      </Stats>
    </Card>
  );
}
