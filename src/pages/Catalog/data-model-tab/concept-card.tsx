/**
 * ConceptCard — one card per measure / dimension / segment. Renders type
 * icon (colour-coded), FQN as the headline, cube + description, and a
 * "Used by N metrics" pill linking back to the registry.
 */

import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { SelectionCheckbox } from '../../../shared/catalog-grouped-view/catalog-group-primitives';
import { TypeIcon } from '../../../shared/concept-shell/type-icon';
import type { Concept } from './concept-types';

const Card = styled(Link)<{ $selected: boolean }>`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px 12px 38px;
  border: 1px solid
    ${(p) => (p.$selected ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 10px;
  background: ${(p) =>
    p.$selected ? 'rgba(240, 90, 34, 0.04)' : 'var(--bg-card)'};
  text-decoration: none;
  color: inherit;
  transition: border-color 0.12s ease, background 0.12s ease;

  &:hover {
    border-color: var(--brand);
  }
`;

const HeadRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Fqn = styled.code`
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-all;
`;

const SubRow = styled.div`
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--text-muted);
`;

const Description = styled.p`
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
`;

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  margin-top: 4px;
`;

const UsedBy = styled.span<{ $unreferenced?: boolean }>`
  padding: 2px 8px;
  border-radius: 999px;
  background: ${(p) =>
    p.$unreferenced ? 'transparent' : 'rgba(240, 90, 34, 0.10)'};
  color: ${(p) =>
    p.$unreferenced
      ? 'var(--text-muted)'
      : 'var(--brand)'};
  border: ${(p) =>
    p.$unreferenced ? '1px dashed var(--border-card)' : 'none'};
  font-weight: 500;
`;

const TypeTag = styled.span`
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
`;

interface ConceptCardProps {
  concept: Concept;
  usedByCount: number;
  selected?: boolean;
  onToggleSelected?: (id: string) => void;
}

function conceptUrl(concept: Concept): string {
  return `/catalog/concept/${concept.type}/${encodeURIComponent(concept.fqn)}`;
}

export function ConceptCard({
  concept,
  usedByCount,
  selected = false,
  onToggleSelected,
}: ConceptCardProps) {
  const id = `${concept.type}:${concept.fqn}`;
  return (
    <Card to={conceptUrl(concept)} $selected={selected}>
      {onToggleSelected && (
        <SelectionCheckbox
          checked={selected}
          onToggle={() => onToggleSelected(id)}
          ariaLabel={`Select ${concept.type} ${concept.fqn}`}
        />
      )}
      <HeadRow>
        <TypeIcon kind={concept.type} />
        <Fqn>{concept.fqn}</Fqn>
      </HeadRow>
      <SubRow>
        <span>{concept.cube}</span>
        {concept.meta?.aggType && <span>· {concept.meta.aggType}</span>}
        {concept.meta?.dimensionType && <span>· {concept.meta.dimensionType}</span>}
      </SubRow>
      {(concept.description || concept.title) && (
        <Description>{concept.description ?? concept.title}</Description>
      )}
      <Footer>
        <TypeTag>{concept.type}</TypeTag>
        <UsedBy $unreferenced={usedByCount === 0}>
          {usedByCount === 0
            ? 'unreferenced'
            : `used by ${usedByCount} metric${usedByCount === 1 ? '' : 's'}`}
        </UsedBy>
      </Footer>
    </Card>
  );
}
