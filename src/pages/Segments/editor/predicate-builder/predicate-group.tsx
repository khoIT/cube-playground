/** Recursive AND/OR group renderer with leaf and nested group support. */

import { ReactElement } from 'react';
import { Button } from 'antd';
import { PlusOutlined, CloseOutlined } from '@ant-design/icons';
import { PredicateLeaf } from './predicate-leaf';
import type { MemberCatalog } from './use-predicate-member-catalog';
import type { GroupNode, PredicateNode, LeafValueType, LeafOperator } from '../../../../types/segment-api';
import type { Path } from '../hooks/use-predicate-state';

interface Props {
  node: GroupNode;
  path: Path;
  isRoot?: boolean;
  toggleConj: (path: Path) => void;
  addLeaf: (path: Path) => void;
  addGroup: (path: Path) => void;
  removeNode: (path: Path) => void;
  setLeafMember: (path: Path, member: string, type: LeafValueType) => void;
  setLeafOp: (path: Path, op: LeafOperator) => void;
  setLeafValues: (path: Path, values: unknown[]) => void;
  /** Threaded down from editor-view; undefined = degrade to free-text Input. */
  catalog?: MemberCatalog | null;
}

export function PredicateGroup(props: Props): ReactElement {
  const {
    node, path, isRoot = false,
    toggleConj, addLeaf, addGroup, removeNode,
    setLeafMember, setLeafOp, setLeafValues,
    catalog,
  } = props;

  return (
    <div
      style={{
        border: '1px dashed var(--border-card)',
        borderRadius: 10,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: isRoot ? 'transparent' : 'var(--bg-card-subtle, var(--bg-card))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => toggleConj(path)}
          style={{
            border: 0,
            background: node.op === 'AND' ? 'var(--brand)' : 'var(--accent, #f59e0b)',
            color: '#fff',
            padding: '2px 12px',
            borderRadius: 999,
            fontWeight: 600,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          {node.op}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {node.children.length} condition{node.children.length === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        {!isRoot && (
          <Button type="text" icon={<CloseOutlined />} onClick={() => removeNode(path)} aria-label="Remove group" />
        )}
      </div>

      {node.children.map((child, idx) => {
        const childPath = [...path, idx];
        if (child.kind === 'group') {
          return (
            <PredicateGroup
              key={child.id}
              node={child}
              path={childPath}
              toggleConj={toggleConj}
              addLeaf={addLeaf}
              addGroup={addGroup}
              removeNode={removeNode}
              setLeafMember={setLeafMember}
              setLeafOp={setLeafOp}
              setLeafValues={setLeafValues}
              catalog={catalog}
            />
          );
        }
        return (
          <PredicateLeaf
            key={child.id}
            node={child}
            onMember={(m, t) => setLeafMember(childPath, m, t)}
            onOp={(o) => setLeafOp(childPath, o)}
            onValues={(v) => setLeafValues(childPath, v)}
            onRemove={() => removeNode(childPath)}
            catalog={catalog}
          />
        );
      })}

      <div style={{ display: 'inline-flex', gap: 8 }}>
        <Button size="small" icon={<PlusOutlined />} onClick={() => addLeaf(path)}>
          Add condition
        </Button>
        <Button size="small" onClick={() => addGroup(path)}>Add group</Button>
      </div>
    </div>
  );
}

export function renderRoot(
  root: PredicateNode,
  helpers: Omit<Props, 'node' | 'path' | 'isRoot'>,
): ReactElement | null {
  if (root.kind !== 'group') return null;
  return <PredicateGroup node={root} path={[]} isRoot {...helpers} />;
}

export type { Props as PredicateGroupProps };
