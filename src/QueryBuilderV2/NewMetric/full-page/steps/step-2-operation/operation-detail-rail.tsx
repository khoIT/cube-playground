import styled from 'styled-components';
import { findOp } from './operations';
import { useEligibleColumns } from '../../hooks/use-eligible-columns';
import type { Operation } from '../../../types';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';

const Card = styled.div`
  background: var(--bg-muted);
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border-card);
  margin-bottom: 12px;
`;
const Name = styled.div`
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
`;
const Mono = styled.div`
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
`;
const Section = styled.div`
  margin-top: 16px;
`;
const SectionLabel = styled.div`
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  margin-bottom: 8px;
`;
const ColRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--border-card);
  &:last-child { border-bottom: none; }
`;
const Mute = styled.div`
  font-size: 12.5px;
  color: var(--text-muted);
`;
const Callout = styled.div`
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12.5px;
  color: var(--warning-ink);
`;

export type OperationDetailRailProps = {
  cube: WizardCube | null;
  operation: Operation | null;
};

export function OperationDetailRail({ cube, operation }: OperationDetailRailProps) {
  const def = operation ? findOp(operation) : undefined;
  // For the eligibility preview we use the primary slot's accept type. Ops
  // with no slots (none today) just show "no column needed".
  const primarySlot = def?.inputs[0];
  const { eligible } = useEligibleColumns(cube, primarySlot?.accepts ?? 'all');

  if (!def) {
    return <Mute>Pick an operation to see its formula + eligible columns.</Mute>;
  }
  const noSlots = def.inputs.length === 0;
  return (
    <>
      <Card>
        <Name>{def.name}</Name>
        <Mono>{def.formula}</Mono>
      </Card>
      {def.dontUseFor && <Callout>Don't use for: {def.dontUseFor}</Callout>}
      <Section>
        <SectionLabel>Eligible columns</SectionLabel>
        {noSlots && <Mute>No column needed.</Mute>}
        {!noSlots && eligible.length === 0 && (
          <Mute>No eligible columns on the current source.</Mute>
        )}
        {eligible.slice(0, 6).map((c) => (
          <ColRow key={c.name}>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {c.name.split('.').slice(-1)[0]}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{c.type ?? '—'}</span>
          </ColRow>
        ))}
        {eligible.length > 6 && (
          <Mute style={{ marginTop: 6 }}>+ {eligible.length - 6} more</Mute>
        )}
      </Section>
    </>
  );
}
