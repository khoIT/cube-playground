/**
 * 5-tab strip for MetricDetailPage: Overview · Formula · Lineage · Slices ·
 * Activity. Pure UI — selected key is lifted to the parent.
 */

import styled, { css } from 'styled-components';

export type DetailTabKey = 'overview' | 'formula' | 'lineage' | 'slices' | 'activity';

const Strip = styled.div`
  display: flex;
  gap: 4px;
  padding: 0 24px;
  border-bottom: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-app, transparent);
`;

const TabBtn = styled.button<{ $active: boolean }>`
  position: relative;
  height: 38px;
  padding: 0 14px;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #525252);
  cursor: pointer;

  &:hover { color: var(--text-primary, #171717); }

  ${(p) =>
    p.$active &&
    css`
      color: var(--brand, #f05a22);
      &::after {
        content: '';
        position: absolute;
        left: 14px;
        right: 14px;
        bottom: -1px;
        height: 2px;
        background: var(--brand, #f05a22);
      }
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
