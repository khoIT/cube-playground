import styled from 'styled-components';
import { Database, Layers } from 'lucide-react';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';

const Card = styled.button<{ $selected: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  background: var(--bg-card);
  border: 1px solid ${(p) => (p.$selected ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 12px;
  padding: 14px;
  cursor: pointer;
  transition: border-color 120ms;
  &:hover { border-color: var(--brand); }
  outline: none;
  box-shadow: ${(p) => (p.$selected ? '0 0 0 3px var(--brand-soft)' : 'none')};
`;

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
`;

const Sub = styled.div`
  font-size: 12.5px;
  color: var(--text-muted);
  margin-top: 2px;
`;

const Meta = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--text-secondary);
`;

const Tag = styled.span`
  display: inline-block;
  padding: 2px 6px;
  background: var(--bg-muted);
  color: var(--text-secondary);
  border-radius: 6px;
  font-size: 11.5px;
`;

const TagRow = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
`;

export type SourceCardProps = {
  cube: WizardCube;
  selected: boolean;
  onSelect: () => void;
};

function cubeTags(c: WizardCube): string[] {
  const tags = new Set<string>();
  for (const m of c.measures ?? []) {
    const t = m.meta?.tags;
    if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') tags.add(x);
  }
  return Array.from(tags).slice(0, 4);
}

export function SourceCard({ cube, selected, onSelect }: SourceCardProps) {
  const Icon = cube.type === 'view' ? Layers : Database;
  const measures = cube.measures?.length ?? 0;
  const dims = cube.dimensions?.length ?? 0;
  return (
    <Card $selected={selected} onClick={onSelect} type="button">
      <Title>
        <Icon size={16} color="var(--brand)" />
        {cube.title || cube.name}
      </Title>
      <Sub>{cube.name}</Sub>
      <Meta>
        <span>{measures} measures</span>
        <span>·</span>
        <span>{dims} dimensions</span>
        {cube.joins?.length ? <><span>·</span><span>{cube.joins.length} joins</span></> : null}
      </Meta>
      <TagRow>
        {cubeTags(cube).map((t) => <Tag key={t}>{t}</Tag>)}
      </TagRow>
    </Card>
  );
}
