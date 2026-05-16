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
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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

  return (
    <Card $selected={selected} type="button" onClick={onClick}>
      <Header>
        <Name>{cube.name}</Name>
        <TypeTag>{cube.type ?? 'cube'}</TypeTag>
      </Header>
      {cube.title && <Title>{cube.title}</Title>}
      {cube.description && <Description>{cube.description}</Description>}
      <Stats>
        <Stat>{measureCount} measures</Stat>
        <Stat>{dimensionCount} dimensions</Stat>
        {joinCount > 0 && <Stat>{joinCount} joins</Stat>}
        {hasRollups && <Stat>Rollup × {cube.preAggregations!.length}</Stat>}
      </Stats>
    </Card>
  );
}
