/**
 * RightPaneTabs — the Chart / Analysis / Compare tab strip for the right pane.
 *
 * Presentational only: receives the active view + change/collapse callbacks.
 * Styled with design tokens to sit flush under the pane top, mirroring the
 * center tab strip's visual weight (icon + label, brand-tinted active state).
 */

import styled from 'styled-components';
import { LineChart, Filter, GitCompare, ChevronRight } from 'lucide-react';
import { Button, TooltipProvider } from '@cube-dev/ui-kit';

export type RightPaneView = 'chart' | 'analysis' | 'compare';

const TABS: { value: RightPaneView; label: string; Icon: typeof LineChart }[] = [
  { value: 'chart', label: 'Chart', Icon: LineChart },
  { value: 'analysis', label: 'Analysis', Icon: Filter },
  { value: 'compare', label: 'Compare', Icon: GitCompare },
];

const Strip = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-card);
  min-height: 44px;
  flex-shrink: 0;
`;

const Spacer = styled.div`
  flex: 1;
`;

const TabBtn = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 11px;
  border-radius: var(--radius-sm);
  border: 1px solid ${(p) => (p.$active ? 'var(--border-card)' : 'transparent')};
  background: ${(p) => (p.$active ? 'var(--bg-card)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-primary)' : 'var(--text-tertiary, var(--text-muted))')};
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: ${(p) => (p.$active ? 'var(--shadow-pane, 0 1px 2px rgba(0,0,0,.04))' : 'none')};
  transition: background 0.12s ease, color 0.12s ease;

  & svg {
    color: ${(p) => (p.$active ? 'var(--brand)' : 'inherit')};
  }

  &:hover {
    background: ${(p) => (p.$active ? 'var(--bg-card)' : 'var(--bg-muted)')};
    color: ${(p) => (p.$active ? 'var(--text-primary)' : 'var(--text-secondary)')};
  }
`;

type Props = {
  value: RightPaneView;
  onChange: (value: RightPaneView) => void;
  onCollapse: () => void;
};

export function RightPaneTabs({ value, onChange, onCollapse }: Props) {
  return (
    <Strip role="tablist" aria-label="Right pane view">
      {TABS.map(({ value: v, label, Icon }) => {
        const active = value === v;
        return (
          <TabBtn
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            $active={active}
            onClick={() => onChange(v)}
          >
            <Icon size={15} strokeWidth={1.8} />
            {label}
          </TabBtn>
        );
      })}
      <Spacer />
      <TooltipProvider title="Collapse pane">
        <Button
          qa="ChartSidePaneCollapseBtn"
          type="clear"
          size="small"
          icon={<ChevronRight size={14} strokeWidth={2.25} />}
          aria-label="Collapse pane"
          onPress={onCollapse}
        />
      </TooltipProvider>
    </Strip>
  );
}
