/**
 * 5-tab strip for MetricDetailPage: Overview · Formula · Lineage · Slices ·
 * Activity. Pure UI — selected key is lifted to the parent.
 */

import styled, { css } from 'styled-components';

export type DetailTabKey = 'overview' | 'formula' | 'lineage' | 'slices' | 'activity';

const Strip = styled.div`
  display: flex;
  gap: 2px;
  padding: 0 24px;
  border-top: 1px solid var(--border-card);
  border-bottom: 1px solid var(--border-card);
  background: var(--surface-sidebar);
`;

const TabBtn = styled.button<{ $active: boolean }>`
  position: relative;
  padding: 10px 14px;
  border: 0;
  background: transparent;
  font-family: var(--font-sans);
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  border-bottom: 3px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;

  &:hover { color: var(--text-primary); }

  ${(p) =>
    p.$active &&
    css`
      color: var(--text-primary);
      font-weight: 600;
      border-bottom-color: var(--brand);
    `}
`;

const LABELS: Record<DetailTabKey, string> = {
  overview: 'Overview',
  formula: 'Formula',
  lineage: 'Lineage',
  slices: 'Slices',
  activity: 'Activity',
};

const ORDER: DetailTabKey[] = ['overview', 'formula', 'lineage', 'slices', 'activity'];

interface MetricDetailTabsProps {
  active: DetailTabKey;
  onChange: (key: DetailTabKey) => void;
}

export function MetricDetailTabs({ active, onChange }: MetricDetailTabsProps) {
  return (
    <Strip role="tablist" aria-label="Metric detail sections">
      {ORDER.map((key) => (
        <TabBtn
          key={key}
          role="tab"
          aria-selected={active === key}
          $active={active === key}
          onClick={() => onChange(key)}
        >
          {LABELS[key]}
        </TabBtn>
      ))}
    </Strip>
  );
}
