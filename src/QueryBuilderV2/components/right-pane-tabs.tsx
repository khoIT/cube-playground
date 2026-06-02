/**
 * RightPaneTabs — the Chart / Analysis / Compare tab strip for the right pane.
 *
 * Presentational only: receives the active view + change/collapse callbacks.
 * Layer-1 (mode) selector: a neutral segmented pill — the active tab lifts on a
 * white card with a brand-tinted icon, never a brand fill. The loud brand fill
 * is reserved for the Layer-2 view selector below, so the two selection layers
 * read as depth (mode over view) rather than competing for the same color.
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

/** Recessed track that holds the mode tabs — the pill the active tab lifts out of. */
const Pill = styled.div`
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: var(--bg-muted);
  border-radius: var(--radius-md);
`;

const TabBtn = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 13px;
  border: 0;
  border-radius: 6px;
  background: ${(p) => (p.$active ? 'var(--bg-card)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-primary)' : 'var(--text-secondary)')};
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
    color: var(--text-primary);
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
      <Pill>
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
      </Pill>
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
