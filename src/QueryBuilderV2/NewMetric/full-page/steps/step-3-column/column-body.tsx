import styled from 'styled-components';
import { AlertTriangle } from 'lucide-react';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import type { Operation } from '../../../types';
import { findOp } from '../step-2-operation/operations';
import { SlotPicker } from './slot-picker';

const Empty = styled.div`
  padding: 24px;
  background: var(--bg-muted);
  border-radius: 10px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
`;
const Grid = styled.div<{ $cols: number }>`
  display: grid;
  /* 1 slot → single column. 2 slots → side-by-side. 3+ slots → vertical
     stack (single column) so each slot's eligibility grid keeps its full
     width and the cube-grouping dividers stay readable. */
  grid-template-columns: ${(p) => (p.$cols === 2 ? 'repeat(2, minmax(0, 1fr))' : '1fr')};
  gap: 16px;
  align-items: start;
`;
const Warning = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--warning-ink);
`;

export type ColumnBodyProps = {
  /** Union of selected source cubes (multi-source-aware). */
  cubes: WizardCube[];
  operation: Operation;
  /**
   * Current slot inputs from `draft.inputs`. Keys are slot ids (e.g. `value`,
   * `numerator`, `denominator`); values are qualified member names.
   */
  inputs: Record<string, string | null>;
  /** Slot writer — forwards to `setInput(slotId, memberName)`. */
  onSelect: (slotId: string, memberName: string) => void;
};

export function ColumnBody({ cubes, operation, inputs, onSelect }: ColumnBodyProps) {
  const def = findOp(operation);
  if (!def) {
    return <Empty>Pick an operation first.</Empty>;
  }
  if (def.inputs.length === 0) {
    return <Empty>No column needed — this operation counts rows.</Empty>;
  }
  if (cubes.length === 0) {
    return <Empty>Pick at least one source cube first.</Empty>;
  }

  const sameMember =
    operation === 'ratio' &&
    !!inputs.numerator &&
    !!inputs.denominator &&
    inputs.numerator === inputs.denominator;

  return (
    <>
      <Grid $cols={def.inputs.length}>
        {def.inputs.map((slot) => (
          <SlotPicker
            key={slot.id}
            slot={slot}
            cubes={cubes}
            selected={inputs[slot.id] ?? null}
            onSelect={(memberName) => onSelect(slot.id, memberName)}
          />
        ))}
      </Grid>
      {sameMember && (
        <Warning>
          <AlertTriangle size={14} strokeWidth={2} />
          Numerator and denominator are the same — your ratio will always be 1.
        </Warning>
      )}
    </>
  );
}
