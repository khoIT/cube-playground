import { ReactNode, useEffect } from 'react';
import {
  Button,
  Flex,
  ResizablePanel,
  Space,
  tasty,
  Text,
  TooltipProvider,
} from '@cube-dev/ui-kit';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useLocalStorage } from '../hooks';

const CHART_PANE_WIDTH_KEY = 'gds-cube:chart-pane-width';
const CHART_PANE_COLLAPSED_KEY = 'gds-cube:chart-pane-collapsed';

const MIN_WIDTH = 280;
const DEFAULT_WIDTH = 420;
const COLLAPSED_WIDTH = 36;

const ContainerCollapsed = tasty(Flex, {
  qa: 'ChartSidePaneCollapsed',
  styles: {
    flow: 'column',
    placeItems: 'center start',
    placeContent: 'start',
    width: `${COLLAPSED_WIDTH}px`,
    minWidth: `${COLLAPSED_WIDTH}px`,
    padding: '1x 0',
    border: 'left #dark-05',
    fill: '#white',
    gap: '1x',
  },
});

const VerticalLabel = tasty(Text, {
  styles: {
    writingMode: 'vertical-rl',
    transform: 'rotate(180deg)',
    fontSize: '12px',
    color: '#dark-03',
    userSelect: 'none',
    padding: '1x 0',
  },
});

const ContainerExpanded = tasty(Flex, {
  qa: 'ChartSidePaneExpanded',
  styles: {
    flow: 'column',
    height: '100%',
    border: 'left #dark-05',
    fill: '#white',
    overflow: 'hidden',
  },
});

const PaneHeader = tasty(Space, {
  styles: {
    placeContent: 'space-between',
    padding: '.5x 1x',
    border: 'bottom #dark-05',
  },
});

const PaneBody = tasty(Flex, {
  styles: {
    flow: 'column',
    height: '100%',
    overflow: 'auto',
  },
});

type Props = {
  children: ReactNode;
};

export function ChartSidePane({ children }: Props) {
  const [collapsed, setCollapsed] = useLocalStorage<boolean>(
    CHART_PANE_COLLAPSED_KEY,
    false
  );
  const [width, setWidth] = useLocalStorage<number>(
    CHART_PANE_WIDTH_KEY,
    DEFAULT_WIDTH
  );

  // Clamp width on mount if out of bounds
  useEffect(() => {
    if (typeof width === 'number' && width < MIN_WIDTH) {
      setWidth(MIN_WIDTH);
    }
  }, []);

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
            onPress={() => setCollapsed(false)}
          />
        </TooltipProvider>
        <VerticalLabel>Chart</VerticalLabel>
      </ContainerCollapsed>
    );
  }

  return (
    <ResizablePanel
      qa="ChartSidePaneResizable"
      direction="left"
      size={Math.max(width || DEFAULT_WIDTH, MIN_WIDTH)}
      minSize={MIN_WIDTH}
      maxSize="60%"
      onSizeChange={setWidth}
      isFlex
      flow="column"
      innerStyles={{ height: '100%' }}
    >
      <ContainerExpanded>
        <PaneHeader>
          <Text preset="t4m">Chart</Text>
          <TooltipProvider title="Collapse chart pane">
            <Button
              qa="ChartSidePaneCollapseBtn"
              type="clear"
              size="small"
              icon={<ChevronRight size={14} strokeWidth={2.25} />}
              aria-label="Collapse chart pane"
              onPress={() => setCollapsed(true)}
            />
          </TooltipProvider>
        </PaneHeader>
        <PaneBody>{children}</PaneBody>
      </ContainerExpanded>
    </ResizablePanel>
  );
}
