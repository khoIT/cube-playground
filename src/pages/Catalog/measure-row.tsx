/**
 * MeasureRow — extracted from `detail-panel.tsx` so the parent stays under
 * the 200-line ceiling and the per-measure expand surface is testable in
 * isolation. The styling matches the legacy inline row exactly when
 * `expandable=false`; mf_users rows opt in via `expandable=true` and the
 * children slot is filled with `<CdpProjectionCard>` in Phase 5.
 */

import { ReactNode, KeyboardEvent } from 'react';
import styled from 'styled-components';
import type { CatalogCube, CatalogMeasure } from './use-catalog-meta';

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 4px 0;
`;

const ClickableRow = styled.div<{ $expanded: boolean }>`
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
  &:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
    border-radius: 2px;
  }
`;

const Chevron = styled.span<{ $expanded: boolean }>`
  display: inline-block;
  width: 12px;
  margin-right: 4px;
  color: var(--text-muted);
  transition: transform 120ms;
  transform: ${(p) => (p.$expanded ? 'rotate(90deg)' : 'rotate(0deg)')};
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

const ExpandedRegion = styled.div`
  padding: 8px 0 12px 16px;
`;

interface MeasureRowProps {
  measure: CatalogMeasure;
  cube: CatalogCube;
  expanded: boolean;
  expandable: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

export function MeasureRow({ measure, cube, expanded, expandable, onToggle, children }: MeasureRowProps) {
  const shortName = measure.name.split('.').slice(1).join('.') || measure.name;
  const isWizard = measure.meta?.source === 'wizard';

  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
      return;
    }
    if (e.key === 'Escape' && expanded) {
      e.preventDefault();
      onToggle();
    }
  }

  const content = (
    <span>
      {expandable && <Chevron $expanded={expanded} aria-hidden>▶</Chevron>}
      <Code>{shortName}</Code>
      {measure.aggType && <Chip>{measure.aggType}</Chip>}
      {measure.format && <Chip>{measure.format}</Chip>}
      {isWizard && <WizardChip>Wizard</WizardChip>}
    </span>
  );

  if (!expandable) {
    return (
      <Row data-testid="measure-row" data-measure-name={measure.name} data-cube={cube.name}>
        {content}
      </Row>
    );
  }

  return (
    <div data-testid="measure-row" data-measure-name={measure.name} data-cube={cube.name}>
      <ClickableRow
        $expanded={expanded}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={handleKey}
      >
        {content}
      </ClickableRow>
      {expanded && <ExpandedRegion>{children}</ExpandedRegion>}
    </div>
  );
}
