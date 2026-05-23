/** A single predicate leaf: member + operator + value + remove. */

import { ReactElement } from 'react';
import { Button, Input, Select } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { operatorsFor } from './operators';
import { ValueInput } from './value-input';
import type { LeafNode, LeafValueType, LeafOperator } from '../../../../types/segment-api';

interface Props {
  node: LeafNode;
  onMember: (member: string, type: LeafValueType) => void;
  onOp: (op: LeafOperator) => void;
  onValues: (values: unknown[]) => void;
  onRemove: () => void;
}

const TYPES: LeafValueType[] = ['string', 'number', 'time', 'boolean'];

export function PredicateLeaf({ node, onMember, onOp, onValues, onRemove }: Props): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        rowGap: 8,
        padding: '8px 10px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 8,
      }}
    >
      <Input
        value={node.member}
        onChange={(e) => onMember(e.target.value, node.type)}
        placeholder="cube.column"
        style={{ minWidth: 200, fontFamily: 'var(--font-mono)' }}
      />
      <Select
        value={node.type}
        onChange={(t) => onMember(node.member, t as LeafValueType)}
        options={TYPES.map((t) => ({ value: t, label: t }))}
        style={{ width: 100 }}
      />
      <Select
        value={node.op}
        onChange={(op) => onOp(op as LeafOperator)}
        options={operatorsFor(node.type).map((o) => ({ value: o.id, label: o.label }))}
        style={{ minWidth: 140 }}
      />
      {/* Flex-grow wrapper so multi-value pills (date range, in/notIn) fully reveal */}
      <div style={{ flex: 1, minWidth: 240, display: 'flex', alignItems: 'center' }}>
        <ValueInput type={node.type} op={node.op} values={node.values} onChange={onValues} />
      </div>
      <Button type="text" icon={<CloseOutlined />} onClick={onRemove} aria-label="Remove condition" />
    </div>
  );
}
