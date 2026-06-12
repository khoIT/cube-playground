/**
 * A single predicate leaf: member + operator + value + remove.
 *
 * The member field renders as a searchable grouped Select when a /meta catalog
 * is available, auto-setting the leaf type on pick. When the catalog is absent
 * (meta unavailable or primary cube not yet chosen) it degrades to a free-text
 * Input so existing predicates remain fully editable.
 */

import { ReactElement } from 'react';
import { Button, Input, Select } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { operatorsFor } from './operators';
import { ValueInput } from './value-input';
import type { MemberCatalog } from './use-predicate-member-catalog';
import type { LeafNode, LeafValueType, LeafOperator } from '../../../../types/segment-api';

interface Props {
  node: LeafNode;
  onMember: (member: string, type: LeafValueType) => void;
  onOp: (op: LeafOperator) => void;
  onValues: (values: unknown[]) => void;
  onRemove: () => void;
  /** When provided, replaces the free-text Input with a grouped meta-driven Select. */
  catalog?: MemberCatalog | null;
}

const TYPES: LeafValueType[] = ['string', 'number', 'time', 'boolean'];

/** Build antd grouped Select options from the catalog. */
function buildMemberOptions(catalog: MemberCatalog) {
  return catalog.groups.map((group) => ({
    label: (
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {group.title}
      </span>
    ),
    title: group.cube,
    options: group.members.map((m) => ({
      value: m.name,
      label: (
        <span>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{m.title}</span>
          {m.kind === 'measure' && (
            <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--text-muted, var(--text-secondary))', opacity: 0.7 }}>
              measure
            </span>
          )}
        </span>
      ),
    })),
  }));
}

export function PredicateLeaf({ node, onMember, onOp, onValues, onRemove, catalog }: Props): ReactElement {
  const hasCatalog = catalog != null && catalog.groups.length > 0;

  const handleMemberSelect = (value: string) => {
    // Auto-set the leaf type from meta when a known member is picked.
    const metaEntry = catalog?.byName.get(value);
    const newType: LeafValueType = metaEntry ? metaEntry.type : node.type;
    onMember(value, newType);
  };

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
      {hasCatalog ? (
        <Select
          showSearch
          value={node.member || undefined}
          placeholder="cube.column"
          options={buildMemberOptions(catalog!)}
          onChange={handleMemberSelect}
          // Allow the user to type a custom member not yet in /meta.
          // The "custom entry" is handled by typing and then blurring without
          // selecting — we keep the free-text escape hatch via onBlur below.
          onBlur={(e) => {
            const raw = (e.target as HTMLInputElement).value?.trim();
            if (raw && raw !== node.member && !catalog?.byName.has(raw)) {
              onMember(raw, node.type);
            }
          }}
          filterOption={(input, option) => {
            if (!option) return false;
            // Match against the option value (member name) for keyboard search.
            return String(option.value ?? '').toLowerCase().includes(input.toLowerCase());
          }}
          style={{ minWidth: 220, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
          dropdownStyle={{ minWidth: 280 }}
        />
      ) : (
        <Input
          value={node.member}
          onChange={(e) => onMember(e.target.value, node.type)}
          placeholder="cube.column"
          style={{ minWidth: 200, fontFamily: 'var(--font-mono)' }}
        />
      )}
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
        <ValueInput
          type={node.type}
          op={node.op}
          values={node.values}
          onChange={onValues}
          member={node.member || undefined}
        />
      </div>
      <Button type="text" icon={<CloseOutlined />} onClick={onRemove} aria-label="Remove condition" />
    </div>
  );
}
