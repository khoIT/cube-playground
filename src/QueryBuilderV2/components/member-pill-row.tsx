import { Plus, X } from 'lucide-react';
import { ReactNode } from 'react';
import styled from 'styled-components';

import { useCubeAlias } from '../../hooks/use-cube-alias';

export type PillKind = 'dimension' | 'measure' | 'time' | 'filter';

const KIND_META: Record<PillKind, { label: string; color: string }> = {
  dimension: { label: 'Dimensions', color: 'var(--chart-2)' },
  measure: { label: 'Measures', color: 'var(--brand)' },
  time: { label: 'Time', color: 'var(--chart-3)' },
  filter: { label: 'Filters', color: 'var(--chart-5)' },
};

const Row = styled.div`
  display: grid;
  grid-template-columns: 110px 1fr;
  align-items: start;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-card);

  &:last-child {
    border-bottom: 0;
  }
`;

const RowLabel = styled.span`
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  line-height: 26px;
`;

const Pills = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
`;

const PillBase = styled.span<{ $accent: string }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-muted);
  border: 1px solid var(--border-card);
  border-left: 3px solid ${(p) => p.$accent};
  border-radius: var(--radius-pill);
  padding: 2px 4px 2px 8px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--text-primary);
  max-width: 100%;
`;

const PillText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
`;

const PillMono = styled.span`
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  margin-left: 4px;
`;

const Granularity = styled.span`
  background: var(--bg-card);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border-card);
`;

const RemoveButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--border-strong);
    color: var(--text-primary);
  }
`;

const AddButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: transparent;
  border: 1px dashed var(--border-strong);
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 12px;
  cursor: pointer;

  &:hover {
    border-color: var(--brand);
    color: var(--brand);
  }
`;

const Hint = styled.span`
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--text-muted);
`;

export type PillItem = {
  key: string;
  member: string;
  label?: string;
  granularity?: string;
  onRemove: () => void;
  extra?: ReactNode;
};

type MemberPillProps = {
  item: PillItem;
  accent: string;
};

function MemberPill({ item, accent }: MemberPillProps) {
  const cubeName = item.member.split('.')[0] ?? '';
  const { alias } = useCubeAlias(cubeName);
  const memberSegment = item.member.split('.').slice(1).join('.') || item.member;
  const display = item.label ?? `${alias.displayName ?? cubeName} · ${memberSegment}`;

  return (
    <PillBase $accent={accent}>
      <PillText title={item.member}>{display}</PillText>
      <PillMono>{item.member}</PillMono>
      {item.granularity ? <Granularity>{item.granularity}</Granularity> : null}
      {item.extra}
      <RemoveButton type="button" aria-label="Remove" onClick={item.onRemove}>
        <X size={12} strokeWidth={2.5} />
      </RemoveButton>
    </PillBase>
  );
}

type MemberPillRowProps = {
  kind: PillKind;
  items: PillItem[];
  onAdd?: () => void;
  emptyHint?: string;
};

export function MemberPillRow({ kind, items, onAdd, emptyHint }: MemberPillRowProps) {
  const meta = KIND_META[kind];

  return (
    <Row>
      <RowLabel>{meta.label}</RowLabel>
      <Pills>
        {items.map((item) => (
          <MemberPill key={item.key} item={item} accent={meta.color} />
        ))}
        {items.length === 0 && emptyHint ? <Hint>{emptyHint}</Hint> : null}
        {onAdd ? (
          <AddButton type="button" onClick={onAdd}>
            <Plus size={12} strokeWidth={2.5} /> Add
          </AddButton>
        ) : null}
      </Pills>
    </Row>
  );
}
