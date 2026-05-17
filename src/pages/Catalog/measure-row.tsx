/**
 * MeasureRow — clickable navigation surface in the catalog DetailPanel.
 *
 * Each row is a link to the per-measure `/metric/:cube/:member` page. The
 * inline accordion (CDP projection expand) was removed in P2 of the metric-
 * card plan; CDP projection content now lives inside the card itself.
 */

import { KeyboardEvent } from 'react';
import styled from 'styled-components';
import type { CatalogCube, CatalogMeasure } from './use-catalog-meta';

const ClickableRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 4px 0;
  cursor: pointer;
  user-select: none;
  outline: none;
  &:hover code {
    color: var(--brand);
  }
  &:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
    border-radius: 2px;
  }
`;

const Code = styled.code`
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-primary);
`;

const Chip = styled.span`
  display: inline-flex;
  padding: 1px 6px;
  border-radius: var(--pill-mono-radius);
  background: var(--pill-mono-bg);
  font-size: 10.5px;
  color: var(--text-secondary);
  margin-left: 6px;
`;

const WizardChip = styled.span`
  display: inline-flex;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--brand-soft);
  border: 1px solid var(--brand);
  color: var(--brand);
  font-size: 10px;
  font-weight: 600;
  margin-left: 6px;
`;

interface MeasureRowProps {
  measure: CatalogMeasure;
  cube: CatalogCube;
  onClick: () => void;
}

export function MeasureRow({ measure, cube, onClick }: MeasureRowProps) {
  const shortName = measure.name.split('.').slice(1).join('.') || measure.name;
  const isWizard = measure.meta?.source === 'wizard';

  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  }

  return (
    <ClickableRow
      data-testid="measure-row"
      data-measure-name={measure.name}
      data-cube={cube.name}
      role="link"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKey}
    >
      <span>
        <Code>{shortName}</Code>
        {measure.aggType && <Chip>{measure.aggType}</Chip>}
        {measure.format && <Chip>{measure.format}</Chip>}
        {isWizard && <WizardChip>Wizard</WizardChip>}
      </span>
    </ClickableRow>
  );
}
