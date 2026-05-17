import styled from 'styled-components';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import type { DimBuilder, DimKind } from '../../../types';
import { PassthroughBuilder } from './passthrough-builder';
import { TimeSinceBuilder } from './time-since-builder';
import { BandingBuilder } from './banding-builder';
import { BooleanBuilder } from './boolean-builder';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;
const Heading = styled.div`
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
`;
const Empty = styled.div`
  color: var(--text-muted);
  padding: 24px;
  background: var(--bg-muted);
  border-radius: 10px;
  font-size: 13px;
`;

export type DimBuilderBodyProps = {
  cube: WizardCube | null;
  dimKind: DimKind | undefined;
  value: DimBuilder | undefined;
  onChange: (next: DimBuilder) => void;
};

export function DimBuilderBody({ cube, dimKind, value, onChange }: DimBuilderBodyProps) {
  if (!dimKind) {
    return <Empty>Pick a dimension kind on the previous step before configuring the builder.</Empty>;
  }

  // When the active dim-kind diverges from the value's kind, render the picker
  // for the active dim-kind with an empty value — the reducer wipes the prior
  // dimBuilder on dimKind change in NewMetricPage (see P1 reducer rules).
  const valueForKind = value && value.kind === dimKind ? value : undefined;

  return (
    <Wrap>
      <Heading>Configuring a <strong>{dimKind}</strong> dimension on cube <code>{cube?.name ?? '—'}</code>.</Heading>
      {dimKind === 'banding' && (
        <BandingBuilder cube={cube} value={valueForKind as any} onChange={onChange} />
      )}
      {dimKind === 'time-since' && (
        <TimeSinceBuilder cube={cube} value={valueForKind as any} onChange={onChange} />
      )}
      {dimKind === 'passthrough' && (
        <PassthroughBuilder cube={cube} value={valueForKind as any} onChange={onChange} />
      )}
      {dimKind === 'boolean' && (
        <BooleanBuilder cube={cube} value={valueForKind as any} onChange={onChange} />
      )}
    </Wrap>
  );
}
