import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { Lock } from 'lucide-react';
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

const Card = styled.button<{ $selected: boolean; $disabled: boolean }>`
  text-align: left;
  background: ${(p) =>
    p.$disabled ? 'var(--bg-muted)'
    : p.$selected ? 'var(--brand-soft)'
    : 'var(--bg-card)'};
  border: 1px solid ${(p) => (p.$selected ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 10px;
  padding: 9px 11px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  opacity: ${(p) => (p.$disabled ? 0.6 : 1)};
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  &:hover { border-color: ${(p) => (p.$disabled ? 'var(--border-card)' : 'var(--brand)')}; }
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
const LockIcon = styled(Lock)`
  color: var(--text-muted);
  margin-left: auto;
  flex: none;
`;

export type OperationBodyProps = {
  cube: WizardCube | null;
  operation: Operation | null;
  /** Number of source cubes the user has selected. Drives source-count gating. */
  sourceCount: number;
  onSelect: (op: Operation) => void;
  /** Called when the user clicks a card disabled by source-count gating. */
  onRequestBack?: () => void;
};

type Gate = { reason: 'source-count'; need: number } | null;

function OperationCard({
  def,
  cube,
  selected,
  gated,
  onClick,
}: {
  def: OperationDef;
  cube: WizardCube | null;
  selected: boolean;
  gated: Gate;
  onClick: () => void;
}) {
  const primarySlot = def.inputs[0];
  const { eligible } = useEligibleColumns(cube, primarySlot?.accepts ?? 'all');
  const isGated = !!gated;
  const eligibleLabel = isGated
    ? `Needs ${gated!.need} sources — go back`
    : def.inputs.length === 0
      ? 'rows only'
      : `${eligible.length} eligible`;
  const tooltip = isGated
    ? `Pick at least ${gated!.need} source cubes first.`
    : def.description;
  return (
    <Card
      $selected={selected}
      $disabled={isGated}
      onClick={onClick}
      type="button"
      aria-disabled={isGated || undefined}
      title={tooltip}
      aria-label={`${def.name} — ${def.description}`}
    >
      <CardHead>
        <Name>{def.name}</Name>
        {def.pro && !isGated && <ProBadge>Advanced</ProBadge>}
        {isGated && <LockIcon size={12} strokeWidth={2} aria-label="Locked — needs more sources" />}
        {!isGated && selected && <SelectedDot aria-label="Selected" />}
      </CardHead>
      <Formula>{def.formula}</Formula>
      <Foot>
        <span>{eligibleLabel}</span>
      </Foot>
    </Card>
  );
}

export function OperationBody({ cube, operation, sourceCount, onSelect, onRequestBack }: OperationBodyProps) {
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
        {list.map((d) => {
          const gated: Gate = d.minSources > sourceCount
            ? { reason: 'source-count', need: d.minSources }
            : null;
          return (
            <OperationCard
              key={d.id}
              def={d}
              cube={cube}
              selected={operation === d.id}
              gated={gated}
              onClick={() => {
                if (gated) {
                  onRequestBack?.();
                  return;
                }
                onSelect(d.id);
              }}
            />
          );
        })}
      </Grid>
    </>
  );
}
