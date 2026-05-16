import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { Plus } from 'lucide-react';
import {
  FilterGroup,
  FilterLeaf,
  addLeaf,
  addGroup as addNodeGroup,
  emptyTree,
  makeLeaf,
  makeGroup,
  removeNode,
  setGroupOp,
  updateLeaf,
  flattenToSql,
} from '../../../filter-tree';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import { useEligibleColumns } from '../../hooks/use-eligible-columns';
import { FilterLeafRow } from './filter-leaf-row';

const SegRow = styled.div`
  display: inline-flex;
  background: var(--bg-muted);
  border-radius: 8px;
  padding: 2px;
  margin-bottom: 12px;
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
const Block = styled.div`
  background: var(--bg-muted);
  padding: 10px;
  border-radius: 12px;
  border: 1px dashed var(--border-card);
  display: flex;
  flex-direction: column;
  gap: 8px;
`;
const GroupHead = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
`;
const OpToggle = styled.button<{ $active: boolean }>`
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-card)')};
  background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'var(--bg-card)')};
  color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-secondary)')};
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
`;
const AddBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-card);
  border: 1px dashed var(--add-pill-border);
  color: var(--brand);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12.5px;
  cursor: pointer;
  align-self: flex-start;
  &:hover { background: var(--add-pill-hover-bg); }
`;
const SqlBlock = styled.pre`
  background: var(--bg-muted);
  border: 1px solid var(--border-card);
  padding: 12px;
  border-radius: 10px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text-primary);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
`;

export type ViewMode = 'visual' | 'sql' | 'both';

function GroupBlock({
  group,
  isRoot,
  columns,
  onChange,
  onRemove,
}: {
  group: FilterGroup;
  isRoot: boolean;
  columns: ReturnType<typeof useEligibleColumns>['eligible'];
  onChange: (next: FilterGroup) => void;
  onRemove?: () => void;
}) {
  return (
    <Block>
      <GroupHead>
        <span>Group:</span>
        <OpToggle
          $active={group.op === 'AND'}
          onClick={() => onChange({ ...group, op: 'AND' })}
        >AND</OpToggle>
        <OpToggle
          $active={group.op === 'OR'}
          onClick={() => onChange({ ...group, op: 'OR' })}
        >OR</OpToggle>
        {!isRoot && onRemove && (
          <button
            onClick={onRemove}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12 }}
          >
            Remove group
          </button>
        )}
      </GroupHead>
      {group.children.map((c) => {
        if (c.kind === 'leaf') {
          return (
            <FilterLeafRow
              key={c.id}
              leaf={c}
              columns={columns}
              onChange={(patch) => onChange({
                ...group,
                children: group.children.map((x) =>
                  x.id === c.id && x.kind === 'leaf' ? { ...x, ...patch, values: patch.values ?? x.values } : x
                ),
              })}
              onRemove={() => onChange({ ...group, children: group.children.filter((x) => x.id !== c.id) })}
            />
          );
        }
        return (
          <GroupBlock
            key={c.id}
            group={c}
            isRoot={false}
            columns={columns}
            onChange={(nextChild) => onChange({
              ...group,
              children: group.children.map((x) => (x.id === c.id ? nextChild : x)),
            })}
            onRemove={() => onChange({ ...group, children: group.children.filter((x) => x.id !== c.id) })}
          />
        );
      })}
      <div style={{ display: 'flex', gap: 8 }}>
        <AddBtn
          type="button"
          onClick={() => {
            const first = columns[0];
            const leaf = makeLeaf(first?.name ?? '', 'string', '=', []);
            onChange({ ...group, children: [...group.children, leaf] });
          }}
        ><Plus size={12} /> Add condition</AddBtn>
        {isRoot && (
          <AddBtn
            type="button"
            onClick={() => onChange({ ...group, children: [...group.children, makeGroup('OR', [])] })}
          ><Plus size={12} /> Add OR group</AddBtn>
        )}
      </div>
    </Block>
  );
}

export type FiltersBodyProps = {
  cube: WizardCube | null;
  tree: FilterGroup;
  onChange: (next: FilterGroup) => void;
};

export function FiltersBody({ cube, tree, onChange }: FiltersBodyProps) {
  const [mode, setMode] = useState<ViewMode>('visual');
  const { eligible } = useEligibleColumns(cube, 'all-dimensions');
  const sql = useMemo(() => {
    try {
      return flattenToSql(tree) || '(no filters)';
    } catch (err) {
      return `-- ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [tree]);

  return (
    <>
      <SegRow>
        {(['visual', 'sql', 'both'] as ViewMode[]).map((m) => (
          <SegBtn key={m} $active={mode === m} onClick={() => setMode(m)}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </SegBtn>
        ))}
      </SegRow>
      {(mode === 'visual' || mode === 'both') && (
        <GroupBlock group={tree} isRoot columns={eligible} onChange={onChange} />
      )}
      {(mode === 'sql' || mode === 'both') && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 6 }}>
            Compiled SQL
          </div>
          <SqlBlock>{sql}</SqlBlock>
        </div>
      )}
    </>
  );
}
