/**
 * ConceptListRow — compact one-line layout used when the user picks list
 * view via the search-row toggle. Same data as `ConceptCard` but denser.
 */

import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { SelectionCheckbox } from '../../../shared/catalog-grouped-view/catalog-group-primitives';
import { TypeIcon } from '../../../shared/concept-shell/type-icon';
import type { Concept } from './concept-types';

const Row = styled(Link)`
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 2fr) 130px;
  align-items: center;
  gap: 12px;
  padding: 10px 16px 10px 38px;
  border: 1px solid var(--border-card);
  border-radius: 8px;
  background: var(--bg-card);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.12s ease;

  &:hover {
    border-color: var(--brand);
  }
`;

const Fqn = styled.code`
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Cube = styled.span`
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Desc = styled.span`
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const UsedBy = styled.span<{ $unreferenced: boolean }>`
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  text-align: center;
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

interface ConceptListRowProps {
  concept: Concept;
  usedByCount: number;
  selected: boolean;
  onToggleSelected: (id: string) => void;
}

function conceptUrl(concept: Concept): string {
  return `/catalog/concept/${concept.type}/${encodeURIComponent(concept.fqn)}`;
}

export function ConceptListRow({
  concept,
  usedByCount,
  selected,
  onToggleSelected,
}: ConceptListRowProps) {
  const id = `${concept.type}:${concept.fqn}`;
  return (
    <Row to={conceptUrl(concept)}>
      <SelectionCheckbox
        checked={selected}
        onToggle={() => onToggleSelected(id)}
        ariaLabel={`Select ${concept.type} ${concept.fqn}`}
      />
      <TypeIcon kind={concept.type} />
      <Fqn>{concept.fqn}</Fqn>
      <Cube>{concept.cube}</Cube>
      <Desc>{concept.description ?? concept.title ?? ''}</Desc>
      <UsedBy $unreferenced={usedByCount === 0}>
        {usedByCount === 0
          ? 'unreferenced'
          : `used by ${usedByCount} metric${usedByCount === 1 ? '' : 's'}`}
      </UsedBy>
    </Row>
  );
}
