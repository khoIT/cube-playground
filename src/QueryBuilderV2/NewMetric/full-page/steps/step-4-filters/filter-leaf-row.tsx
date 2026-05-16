import styled from 'styled-components';
import { X } from 'lucide-react';
import type { FilterLeaf, FilterOperator } from '../../../filter-tree';
import type { EligibleColumn } from '../../hooks/use-eligible-columns';

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 10px;
`;

const Select = styled.select`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12.5px;
  font-family: var(--font-mono);
`;

const Input = styled.input`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12.5px;
  flex: 1;
  &:focus { border-color: var(--brand); outline: none; }
`;

const Remove = styled.button`
  background: none;
  border: none;
  color: var(--danger);
  cursor: pointer;
  padding: 4px;
  &:hover { color: var(--brand-hover); }
`;

const OPS: FilterOperator[] = ['=', '!=', '>', '<', '>=', '<=', 'IN', 'contains', 'startsWith', 'set', 'notSet'];

export type FilterLeafRowProps = {
  leaf: FilterLeaf;
  columns: EligibleColumn[];
  onChange: (patch: Partial<Omit<FilterLeaf, 'id' | 'kind'>>) => void;
  onRemove: () => void;
};

function inferColumnType(col: EligibleColumn | undefined): FilterLeaf['columnType'] {
  const t = (col?.type ?? '').toLowerCase();
  if (t === 'number' || t === 'integer') return t;
  if (t === 'boolean') return 'boolean';
  if (t === 'time' || t === 'date') return t as 'time' | 'date';
  return 'string';
}

export function FilterLeafRow({ leaf, columns, onChange, onRemove }: FilterLeafRowProps) {
  const requiresValue = leaf.op !== 'set' && leaf.op !== 'notSet';
  const isMulti = leaf.op === 'IN' || leaf.op === 'NOT IN';

  return (
    <Row>
      <Select
        value={leaf.column}
        onChange={(e) => {
          const next = e.target.value;
          const col = columns.find((c) => c.name === next);
          onChange({ column: next, columnType: inferColumnType(col), values: [] });
        }}
      >
        <option value="">— pick column —</option>
        {columns.map((c) => (
          <option key={c.name} value={c.name}>{c.name.split('.').slice(-1)[0]}</option>
        ))}
      </Select>
      <Select
        value={leaf.op}
        onChange={(e) => onChange({ op: e.target.value as FilterOperator, values: [] })}
      >
        {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
      {requiresValue && (
        <Input
          placeholder={isMulti ? 'comma-separated values' : 'value'}
          value={isMulti ? leaf.values.join(', ') : (leaf.values[0] ?? '')}
          onChange={(e) => {
            const raw = e.target.value;
            const next = isMulti
              ? raw.split(',').map((v) => v.trim()).filter(Boolean)
              : [raw];
            onChange({ values: next });
          }}
        />
      )}
      <Remove onClick={onRemove} title="Remove condition" type="button">
        <X size={14} />
      </Remove>
    </Row>
  );
}
