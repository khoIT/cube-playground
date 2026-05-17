import { useMemo } from 'react';
import styled from 'styled-components';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import type { DimBuilder } from '../../../types';
import { useEligibleColumns } from '../../hooks/use-eligible-columns';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 560px;
`;
const Row = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
`;
const Label = styled.span`
  font-weight: 600;
  color: var(--text-primary);
`;
const Hint = styled.span`
  font-size: 12px;
  color: var(--text-muted);
`;
const Select = styled.select`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: var(--font-mono);
`;

export type PassthroughBuilderState = Extract<DimBuilder, { kind: 'passthrough' }>;

export type PassthroughBuilderProps = {
  cube: WizardCube | null;
  value: PassthroughBuilderState | undefined;
  onChange: (next: PassthroughBuilderState) => void;
};

function inferType(t: string | undefined): PassthroughBuilderState['outputType'] {
  const lo = (t ?? '').toLowerCase();
  if (lo === 'number' || lo === 'integer' || lo === 'count' || lo === 'sum') return 'number';
  if (lo === 'boolean') return 'boolean';
  if (lo === 'time' || lo === 'date') return 'time';
  return 'string';
}

export function PassthroughBuilder({ cube, value, onChange }: PassthroughBuilderProps) {
  const { eligible } = useEligibleColumns(cube, 'all-dimensions');
  const current: PassthroughBuilderState = value ?? { kind: 'passthrough', column: null, outputType: 'string' };

  const columnsByLeaf = useMemo(() => {
    const map = new Map<string, (typeof eligible)[number]>();
    for (const c of eligible) {
      const leaf = c.name.includes('.') ? c.name.split('.').slice(-1)[0] : c.name;
      map.set(leaf, c);
    }
    return map;
  }, [eligible]);

  return (
    <Wrap>
      <Row>
        <Label>Column</Label>
        <Hint>Pick the column to expose as-is. The dim's <code>sql:</code> will reference this column raw.</Hint>
        <Select
          value={current.column ?? ''}
          onChange={(e) => {
            const next = e.target.value || null;
            const col = next ? columnsByLeaf.get(next) : undefined;
            onChange({
              kind: 'passthrough',
              column: next,
              outputType: col ? inferType(col.type) : current.outputType,
            });
          }}
        >
          <option value="">— pick column —</option>
          {[...columnsByLeaf.keys()].sort().map((leaf) => (
            <option key={leaf} value={leaf}>{leaf}</option>
          ))}
        </Select>
      </Row>

      <Row>
        <Label>Output type</Label>
        <Hint>Defaulted from the source column. Override only if you know the column reads differently.</Hint>
        <Select
          value={current.outputType}
          onChange={(e) => onChange({ ...current, outputType: e.target.value as PassthroughBuilderState['outputType'] })}
        >
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
          <option value="time">time</option>
        </Select>
      </Row>
    </Wrap>
  );
}
