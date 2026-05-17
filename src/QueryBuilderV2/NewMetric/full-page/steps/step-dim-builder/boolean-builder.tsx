import { useMemo } from 'react';
import styled from 'styled-components';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import type { DimBuilder } from '../../../types';
import type { FilterLeaf, FilterOperator } from '../../../filter-tree';
import { makeLeaf } from '../../../filter-tree';
import { useEligibleColumns } from '../../hooks/use-eligible-columns';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 720px;
`;
const Intro = styled.div`
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
`;
const FieldRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;
const Label = styled.span`
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
`;
const Hint = styled.span`
  font-size: 12px;
  color: var(--text-muted);
`;
const Row = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 8px;
`;
const Select = styled.select`
  background: var(--bg-muted);
  border: 1px solid var(--border-card);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12.5px;
  font-family: var(--font-mono);
`;
const Input = styled.input`
  flex: 1;
  background: var(--bg-muted);
  border: 1px solid var(--border-card);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12.5px;
  font-family: var(--font-mono);
  &:focus { border-color: var(--brand); outline: none; }
`;

const OPS: FilterOperator[] = ['=', '!=', '>', '<', '>=', '<=', 'IN', 'contains', 'startsWith', 'set', 'notSet'];

export type BooleanBuilderState = Extract<DimBuilder, { kind: 'boolean' }>;

function inferColumnType(t: string | undefined): FilterLeaf['columnType'] {
  const lo = (t ?? '').toLowerCase();
  if (lo === 'number' || lo === 'integer') return lo;
  if (lo === 'boolean') return 'boolean';
  if (lo === 'time' || lo === 'date') return lo as 'time' | 'date';
  return 'string';
}

export type BooleanBuilderProps = {
  cube: WizardCube | null;
  value: BooleanBuilderState | undefined;
  onChange: (next: BooleanBuilderState) => void;
};

export function BooleanBuilder({ cube, value, onChange }: BooleanBuilderProps) {
  const { eligible } = useEligibleColumns(cube, 'all-dimensions');
  const columns = useMemo(() => {
    const seen = new Map<string, (typeof eligible)[number]>();
    for (const c of eligible) {
      const leaf = c.name.includes('.') ? c.name.split('.').slice(-1)[0] : c.name;
      seen.set(leaf, c);
    }
    return [...seen.entries()].map(([leaf, c]) => ({ leaf, type: c.type ?? 'string' })).sort((a, b) => a.leaf.localeCompare(b.leaf));
  }, [eligible]);

  const current: BooleanBuilderState = value ?? { kind: 'boolean', predicate: null };
  const leaf = current.predicate;

  const requiresValue = leaf && leaf.op !== 'set' && leaf.op !== 'notSet';
  const isMulti = leaf && (leaf.op === 'IN' || leaf.op === 'NOT IN');

  function setLeaf(next: FilterLeaf) {
    onChange({ kind: 'boolean', predicate: next });
  }

  return (
    <Wrap>
      <Intro>
        When this predicate is TRUE, the dimension reads TRUE. The wizard emits
        <code> CASE WHEN &lt;predicate&gt; THEN TRUE ELSE FALSE END</code>. Raw SQL is
        not accepted — the predicate is a single column/op/value leaf so the YAML
        generator can sanitize values.
      </Intro>

      <FieldRow>
        <Label>Predicate</Label>
        <Hint>Pick a column, operator, and value. The auto-name uses these to produce <code>is_&lt;slug&gt;</code>.</Hint>
        <Row>
          <Select
            value={leaf?.column ?? ''}
            onChange={(e) => {
              const next = e.target.value;
              const col = columns.find((c) => c.leaf === next);
              setLeaf(makeLeaf(next, inferColumnType(col?.type), leaf?.op ?? '=', []));
            }}
          >
            <option value="">— column —</option>
            {columns.map((c) => (<option key={c.leaf} value={c.leaf}>{c.leaf}</option>))}
          </Select>
          <Select
            value={leaf?.op ?? '='}
            onChange={(e) => {
              if (!leaf) return;
              setLeaf({ ...leaf, op: e.target.value as FilterOperator, values: e.target.value === 'set' || e.target.value === 'notSet' ? [] : leaf.values });
            }}
            disabled={!leaf}
          >
            {OPS.map((op) => (<option key={op} value={op}>{op}</option>))}
          </Select>
          {requiresValue && leaf && (
            <Input
              value={leaf.values[0] ?? ''}
              placeholder={isMulti ? "comma-separated" : "value"}
              onChange={(e) => {
                const raw = e.target.value;
                const values = isMulti
                  ? raw.split(',').map((s) => s.trim()).filter(Boolean)
                  : [raw];
                setLeaf({ ...leaf, values });
              }}
            />
          )}
        </Row>
      </FieldRow>
    </Wrap>
  );
}
