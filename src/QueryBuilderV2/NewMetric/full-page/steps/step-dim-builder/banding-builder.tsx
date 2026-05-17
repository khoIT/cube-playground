import { useMemo } from 'react';
import styled from 'styled-components';
import { Plus } from 'lucide-react';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import type { BandingRow as BandingRowType, DimBuilder } from '../../../types';
import { useEligibleColumns } from '../../hooks/use-eligible-columns';
import { BandingRowEditor } from './banding-row';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 720px;
`;
const FieldRow = styled.label`
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
const Bands = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;
const AddBtn = styled.button`
  align-self: flex-start;
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bg-card);
  border: 1px dashed var(--border-card);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12.5px;
  &:hover { border-color: var(--brand); color: var(--brand); }
`;
const ElseRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg-muted);
  border-radius: 8px;
`;
const ElseLabel = styled.span`
  font-size: 12.5px;
  color: var(--text-secondary);
`;
const ElseInput = styled.input`
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12.5px;
  font-family: var(--font-mono);
  &:focus { border-color: var(--brand); outline: none; }
`;

export type BandingBuilderState = Extract<DimBuilder, { kind: 'banding' }>;

function makeRow(): BandingRowType {
  return { sql: '', label: '' };
}

export type BandingBuilderProps = {
  cube: WizardCube | null;
  value: BandingBuilderState | undefined;
  onChange: (next: BandingBuilderState) => void;
};

export function BandingBuilder({ cube, value, onChange }: BandingBuilderProps) {
  const { eligible } = useEligibleColumns(cube, 'all-dimensions');
  const current: BandingBuilderState = value ?? {
    kind: 'banding', column: null, bands: [], elseLabel: '',
  };

  const cols = useMemo(() => {
    const leaves = new Set<string>();
    for (const c of eligible) {
      leaves.add(c.name.includes('.') ? c.name.split('.').slice(-1)[0] : c.name);
    }
    return [...leaves].sort();
  }, [eligible]);

  function setRows(rows: BandingRowType[]) {
    onChange({ ...current, bands: rows });
  }
  function addRow() {
    setRows([...current.bands, makeRow()]);
  }
  function updateRow(i: number, patch: Partial<BandingRowType>) {
    setRows(current.bands.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    setRows(current.bands.filter((_, idx) => idx !== i));
  }

  return (
    <Wrap>
      <FieldRow>
        <Label>Underlying column</Label>
        <Hint>The column the bands reference. Used by the auto-name (e.g. <code>ltv_vnd → ltv_vnd_tier</code>).</Hint>
        <Select
          value={current.column ?? ''}
          onChange={(e) => onChange({ ...current, column: e.target.value || null })}
        >
          <option value="">— pick column —</option>
          {cols.map((leaf) => (<option key={leaf} value={leaf}>{leaf}</option>))}
        </Select>
      </FieldRow>

      <FieldRow as="div">
        <Label>Bands</Label>
        <Hint>First match wins. Reference the column as <code>{'{CUBE}'}.column_name</code>.</Hint>
        <Bands>
          {current.bands.map((r, i) => (
            <BandingRowEditor
              key={i}
              row={r}
              onChange={(patch) => updateRow(i, patch)}
              onRemove={() => removeRow(i)}
            />
          ))}
          <AddBtn type="button" onClick={addRow}><Plus size={13} /> Add band</AddBtn>
        </Bands>
      </FieldRow>

      <FieldRow as="div">
        <Label>Else label</Label>
        <ElseRow>
          <ElseLabel>fall-through:</ElseLabel>
          <ElseInput
            value={current.elseLabel}
            placeholder="non_payer"
            onChange={(e) => onChange({ ...current, elseLabel: e.target.value })}
          />
        </ElseRow>
        <Hint>Required. Cube returns NULL if omitted — pick a stable label.</Hint>
      </FieldRow>
    </Wrap>
  );
}
