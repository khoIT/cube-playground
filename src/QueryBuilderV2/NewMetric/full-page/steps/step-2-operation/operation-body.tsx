import { useMemo, useState } from 'react';
import styled from 'styled-components';
import type { Operation } from '../../../types';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import { OPERATIONS, OperationSegment, filterBySegment, OperationDef } from './operations';
import { useEligibleColumns } from '../../hooks/use-eligible-columns';

const SegRow = styled.div`
  display: inline-flex;
  background: var(--bg-muted);
  border-radius: 8px;
  padding: 2px;
  margin-bottom: 16px;
`;
const SegBtn = styled.button<{ $active: boolean }>`
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 6px;
  background: ${(p) => (p.$active ? 'var(--bg-card)' : 'transparent')};
  border: 1px solid ${(p) => (p.$active ? 'var(--border-card)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-primary)' : 'var(--text-secondary)')};
  cursor: pointer;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
`;

const Card = styled.button<{ $selected: boolean }>`
  text-align: left;
  background: var(--bg-card);
  border: 1px solid ${(p) => (p.$selected ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 12px;
  padding: 14px;
  cursor: pointer;
  &:hover { border-color: var(--brand); }
  box-shadow: ${(p) => (p.$selected ? '0 0 0 3px var(--brand-soft)' : 'none')};
`;
const CardHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
`;
const Name = styled.div`
  font-weight: 600;
  font-size: 14.5px;
  color: var(--text-primary);
`;
const Formula = styled.div`
  display: inline-block;
  margin-top: 4px;
  padding: 2px 6px;
  background: var(--bg-muted);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-secondary);
`;
const Desc = styled.div`
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-top: 8px;
`;
const Foot = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 10px;
`;
const ProBadge = styled.span`
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;
const SelectedPill = styled.span`
  background: var(--success);
  color: white;
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
`;

export type OperationBodyProps = {
  cube: WizardCube | null;
  operation: Operation | null;
  onSelect: (op: Operation) => void;
};

function OperationCard({
  def,
  cube,
  selected,
  onClick,
}: {
  def: OperationDef;
  cube: WizardCube | null;
  selected: boolean;
  onClick: () => void;
}) {
  const { eligible } = useEligibleColumns(cube, def.accepts);
  return (
    <Card $selected={selected} onClick={onClick} type="button">
      <CardHead>
        <Name>{def.name}</Name>
        <div style={{ display: 'flex', gap: 6 }}>
          {def.pro && <ProBadge>Advanced</ProBadge>}
          {selected && <SelectedPill>Selected</SelectedPill>}
        </div>
      </CardHead>
      <Formula>{def.formula}</Formula>
      <Desc>{def.description}</Desc>
      <Foot>
        <span>{def.accepts === 'none' ? 'No column required' : `${eligible.length} eligible`}</span>
        <span>{def.example}</span>
      </Foot>
    </Card>
  );
}

export function OperationBody({ cube, operation, onSelect }: OperationBodyProps) {
  const [segment, setSegment] = useState<OperationSegment>('all');
  const list = useMemo(() => filterBySegment(segment), [segment]);
  return (
    <>
      <SegRow>
        {(['common', 'all', 'advanced'] as OperationSegment[]).map((s) => (
          <SegBtn key={s} $active={s === segment} onClick={() => setSegment(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </SegBtn>
        ))}
      </SegRow>
      <Grid>
        {list.map((d) => (
          <OperationCard
            key={d.id}
            def={d}
            cube={cube}
            selected={operation === d.id}
            onClick={() => onSelect(d.id)}
          />
        ))}
      </Grid>
    </>
  );
}
