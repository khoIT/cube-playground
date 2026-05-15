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
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CodeOutlined } from '@ant-design/icons';
import { ChartType, PivotConfig, Query } from '@cubejs-client/core';

import { PaneHeader, PaneTitle } from '../../components/AppPanes';
import { PivotAxes, PivotOptions } from '../Pivot';
import { ChevronIcon } from '../icons/ChevronIcon';
import { ChartTypeToggle } from './chart-type-toggle';

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

const HeaderRight = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
`;

const HeaderDivider = styled.span`
  display: inline-block;
  width: 1px;
  height: 18px;
  background: var(--border-card);
  margin: 0 6px;
`;

const ChartTypeSlot = styled.div`
  display: inline-flex;
  align-items: center;
  margin-right: 4px;
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
}: Props) {
  const [isVizardLoaded, setIsVizardLoaded] = useState(false);

  if (collapsed) {
    return (
      <ContainerCollapsed>
        <TooltipProvider title="Expand chart pane">
          <Button
            qa="ChartSidePaneExpandBtn"
            type="clear"
            size="small"
            icon={<ChevronLeft size={14} strokeWidth={2.25} />}
            aria-label="Expand chart pane"
            onPress={() => onToggleCollapsed(false)}
          />
        </TooltipProvider>
        <VerticalLabel>Chart</VerticalLabel>
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
      <PaneHeader>
        <PaneTitle>Chart</PaneTitle>
        <HeaderRight>
          {onChartTypeChange ? (
            <>
              <ChartTypeSlot>
                <ChartTypeToggle value={chartType} onChange={onChartTypeChange} />
              </ChartTypeSlot>
              {(pivotTrigger || codeTrigger) && <HeaderDivider aria-hidden />}
            </>
          ) : null}
          {pivotTrigger}
          {codeTrigger}
          <TooltipProvider title="Collapse chart pane">
            <Button
              qa="ChartSidePaneCollapseBtn"
              type="clear"
              size="small"
              icon={<ChevronRight size={14} strokeWidth={2.25} />}
              aria-label="Collapse chart pane"
              onPress={() => onToggleCollapsed(true)}
            />
          </TooltipProvider>
        </HeaderRight>
      </PaneHeader>
      <PaneBody>{children}</PaneBody>
    </ContainerExpanded>
  );
}
