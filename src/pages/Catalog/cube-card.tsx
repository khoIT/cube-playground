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
  flex-wrap: wrap;
`;

const Name = styled.div`
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 600;
  min-width: 0;
  word-break: break-word;
`;

const TypeTag = styled.span`
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: var(--radius-full);
  background: var(--pill-mono-bg);
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

// Chips wrap to the next line rather than overflowing the card; each chip
// keeps its own label on one line (count + word stay together, never split).
const Stats = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
`;

const Stat = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  background: var(--pill-mono-bg);
  padding: 2px 8px;
  border-radius: var(--radius-full);
`;

const StatNum = styled.b`
  font-weight: 600;
  color: var(--text-primary);
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
        <Stat>
          <StatNum>{measureCount}</StatNum> measures
        </Stat>
        <Stat>
          <StatNum>{dimensionCount}</StatNum> dimensions
        </Stat>
        {joinCount > 0 && (
          <Stat>
            <StatNum>{joinCount}</StatNum> joins
          </Stat>
        )}
        {hasRollups && (
          <Stat>
            <StatNum>{cube.preAggregations!.length}</StatNum> rollups
          </Stat>
        )}
      </Stats>
    </Card>
  );
}
