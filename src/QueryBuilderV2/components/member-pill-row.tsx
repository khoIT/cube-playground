import { Plus, X } from 'lucide-react';
import { ReactNode } from 'react';
import styled from 'styled-components';

import { useCubeAlias } from '../../hooks/use-cube-alias';

export type PillKind = 'dimension' | 'measure' | 'time' | 'filter';

// Intentional divergence from v2 spec: v2 uses a single dark stripe. We keep
// per-member-type accent colors — it is a UX win for visually scanning rows.
const KIND_META: Record<PillKind, { label: string; color: string }> = {
  dimension: { label: 'Dimensions', color: 'var(--chart-2)' },
  measure: { label: 'Measures', color: 'var(--brand)' },
  time: { label: 'Time', color: 'var(--chart-3)' },
  filter: { label: 'Filters', color: 'var(--chart-5)' },
};

const Row = styled.div`
  display: grid;
  grid-template-columns: var(--qrow-label-width) 1fr;
  align-items: start;
  gap: var(--qrow-gap);
  padding: var(--qrow-padding-y) 12px;
  border-bottom: var(--qrow-divider);

  &:last-child {
    border-bottom: 0;
  }
`;

const RowLabel = styled.span`
  font-family: var(--font-sans);
  font-size: var(--qrow-label-size);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: var(--qrow-label-spacing);
  line-height: var(--pill-height);
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
  height: var(--pill-height);
  background: #fff;
  border: 1px solid var(--neutral-200);
  border-left: var(--pill-accent-width) solid ${(p) => p.$accent};
  border-radius: var(--pill-radius);
  padding: var(--pill-padding);
  font-family: var(--font-sans);
  font-size: var(--pill-text-size);
  color: var(--text-primary);
  max-width: 100%;
`;

const PillText = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
  font-weight: 500;
`;

const PillCube = styled.span`
  color: var(--text-muted);
  font-weight: 400;
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
    background: var(--neutral-100);
    color: var(--text-primary);
  }
`;

const AddButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: var(--add-pill-height);
  padding: var(--add-pill-padding);
  border-radius: var(--add-pill-radius);
  background: transparent;
  border: 1px dashed var(--add-pill-border);
  color: var(--brand);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: var(--add-pill-hover-bg);
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
  const cubeDisplay = alias.displayName ?? cubeName;
  const showSplit = !item.label;

  return (
    <PillBase $accent={accent}>
      <PillText title={item.member}>
        {showSplit ? (
          <>
            <PillCube>{cubeDisplay} ·</PillCube>
            <span>{memberSegment}</span>
          </>
        ) : (
          item.label
        )}
      </PillText>
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
  /** Label text on the add button. Default "Add". TIME passes "Add time". */
  addLabel?: string;
};

export function MemberPillRow({
  kind,
  items,
  onAdd,
  emptyHint,
  addLabel = 'Add',
}: MemberPillRowProps) {
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
            <Plus size={12} strokeWidth={2.5} /> {addLabel}
          </AddButton>
        ) : null}
      </Pills>
    </Row>
  );
}
