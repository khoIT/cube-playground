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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
`;

const Card = styled.button<{ $selected: boolean }>`
  text-align: left;
  background: ${(p) => (p.$selected ? 'var(--brand-soft)' : 'var(--bg-card)')};
  border: 1px solid ${(p) => (p.$selected ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 10px;
  padding: 9px 11px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  &:hover { border-color: var(--brand); }
`;
const CardHead = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`;
const Name = styled.div`
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const Formula = styled.span`
  display: inline-block;
  padding: 1px 5px;
  background: var(--bg-muted);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
`;
const Foot = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 10.5px;
  color: var(--text-muted);
`;
const ProBadge = styled.span`
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 9.5px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex: none;
`;
const SelectedDot = styled.span`
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand);
  margin-left: auto;
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
  const eligibleLabel = def.accepts === 'none' ? 'rows only' : `${eligible.length} eligible`;
  return (
    <Card
      $selected={selected}
      onClick={onClick}
      type="button"
      title={def.description}
      aria-label={`${def.name} — ${def.description}`}
    >
      <CardHead>
        <Name>{def.name}</Name>
        {def.pro && <ProBadge>Pro</ProBadge>}
        {selected && <SelectedDot aria-label="Selected" />}
      </CardHead>
      <Formula>{def.formula}</Formula>
      <Foot>
        <span>{eligibleLabel}</span>
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
