import { FC, ReactNode, useState } from 'react';
import styled from 'styled-components';
import {
  Button,
  Dialog,
  DialogTrigger,
  Divider as UIDivider,
  Header as UIHeader,
  TooltipProvider,
  Title as UITitle,
} from '@cube-dev/ui-kit';
import { ChevronLeft } from 'lucide-react';
import { CodeOutlined } from '@ant-design/icons';
import { ChartType, PivotConfig, Query } from '@cubejs-client/core';

import { PivotAxes, PivotOptions } from '../Pivot';
import { ChevronIcon } from '../icons/ChevronIcon';
import { ChartTypeToggle } from './chart-type-toggle';
import { RightPaneTabs, RightPaneView } from './right-pane-tabs';
import { AnalysisPanel } from '../analysis/analysis-panel';
import { ComparePane } from '../compare/compare-pane';

const ContainerCollapsed = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  height: 100%;
  padding: 8px 0;
  gap: 8px;
`;

const VerticalLabel = styled.span`
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  user-select: none;
  padding: 8px 0;
`;

const ContainerExpanded = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`;

/**
 * Recessed Layer-2 track: holds the brand-filled view selector + tool buttons.
 * The --bg-muted surface sits one level deeper than the white mode pill above,
 * so mode (Layer 1) and view (Layer 2) read as nested depth, not rival tabs.
 */
const ChartToolRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: var(--bg-muted);
  border-bottom: 1px solid var(--border-card);
  flex-shrink: 0;
`;

/** Hairline separating the view selector from the action buttons. */
const ToolDivider = styled.span`
  width: 1px;
  align-self: stretch;
  margin: 4px 2px;
  background: var(--border-card);
`;

const PaneBody = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
`;

type ToggleChartType = Extract<ChartType, 'line' | 'bar' | 'area' | 'table'>;

type Props = {
  children: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: (collapsed: boolean) => void;
  /** Optional chart-type segmented toggle. When omitted, no toggle rendered. */
  chartType?: ChartType;
  onChartTypeChange?: (value: ToggleChartType) => void;
  /** Pivot dialog wiring (mirrors QueryBuilderChart). */
  pivotConfig?: PivotConfig | null;
  onPivotMove?: (arg: any) => void;
  onPivotUpdate?: (arg: any) => void;
  /** Code (Vizard) dialog wiring. */
  VizardComponent?: FC<any>;
  apiToken?: string | null;
  apiUrl?: string;
  query?: Query;
  /** Extra actions rendered in the Chart view toolbar (e.g. Pin to dashboard). */
  chartActions?: ReactNode;
};

export function ChartSidePane({
  children,
  collapsed,
  onToggleCollapsed,
  chartType,
  onChartTypeChange,
  pivotConfig,
  onPivotMove,
  onPivotUpdate,
  VizardComponent,
  apiToken,
  apiUrl,
  query,
  chartActions,
}: Props) {
  const [isVizardLoaded, setIsVizardLoaded] = useState(false);
  const [view, setView] = useState<RightPaneView>('chart');

  if (collapsed) {
    return (
      <ContainerCollapsed>
        <TooltipProvider title="Expand pane">
          <Button
            qa="ChartSidePaneExpandBtn"
            type="clear"
            size="small"
            icon={<ChevronLeft size={14} strokeWidth={2.25} />}
            aria-label="Expand pane"
            onPress={() => onToggleCollapsed(false)}
          />
        </TooltipProvider>
        <VerticalLabel>Insights</VerticalLabel>
      </ContainerCollapsed>
    );
  }

  const pivotTrigger =
    pivotConfig && onPivotMove && onPivotUpdate ? (
      <DialogTrigger type="popover">
        <Button size="small" rightIcon={<ChevronIcon direction="bottom" />}>
          Pivot
        </Button>
        <Dialog border overflow="hidden" width="40x max-content 80x">
          <PivotAxes pivotConfig={pivotConfig} onMove={onPivotMove} />
          <UIDivider />
          <div style={{ padding: '8px' }}>
            <PivotOptions pivotConfig={pivotConfig} onUpdate={onPivotUpdate} />
          </div>
        </Dialog>
      </DialogTrigger>
    ) : null;

  const codeTrigger = VizardComponent ? (
    <DialogTrigger isDismissable type="fullscreen">
      <Button
        type="primary"
        size="small"
        icon={<CodeOutlined />}
        onPress={() => setIsVizardLoaded(true)}
      >
        Code
      </Button>
      <Dialog isDismissable>
        <UIHeader>
          <UITitle>Chart Prototyping</UITitle>
        </UIHeader>
        {isVizardLoaded ? (
          <VizardComponent
            apiToken={apiToken}
            apiUrl={apiUrl}
            query={query}
            pivotConfig={pivotConfig}
          />
        ) : null}
      </Dialog>
    </DialogTrigger>
  ) : null;

  return (
    <ContainerExpanded>
      <RightPaneTabs value={view} onChange={setView} onCollapse={() => onToggleCollapsed(true)} />

      {view === 'chart' && (
        <>
          {(onChartTypeChange || pivotTrigger || codeTrigger || chartActions) && (
            <ChartToolRow>
              {onChartTypeChange ? (
                <ChartTypeToggle value={chartType} onChange={onChartTypeChange} />
              ) : null}
              {onChartTypeChange && (pivotTrigger || codeTrigger || chartActions) ? (
                <ToolDivider />
              ) : null}
              {pivotTrigger}
              {codeTrigger}
              {chartActions}
            </ChartToolRow>
          )}
          <PaneBody>{children}</PaneBody>
        </>
      )}

      {view === 'analysis' && (
        <PaneBody>
          <AnalysisPanel />
        </PaneBody>
      )}

      {view === 'compare' && (
        <PaneBody>
          <ComparePane />
        </PaneBody>
      )}
    </ContainerExpanded>
  );
}
