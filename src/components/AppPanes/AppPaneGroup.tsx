import { ReactNode } from 'react';
import styled from 'styled-components';
import { PanelGroup } from 'react-resizable-panels';

const Group = styled(PanelGroup)`
  width: 100%;
  height: 100%;
  background: var(--bg-app);
`;

const OuterFrame = styled.div`
  width: 100%;
  height: 100%;
  padding: var(--pane-gap);
  background: var(--bg-app);
  box-sizing: border-box;
  display: flex;
  min-height: 0;
`;

type AppPaneGroupProps = {
  autoSaveId: string;
  direction?: 'horizontal' | 'vertical';
  children: ReactNode;
  'data-qa'?: string;
};

export function AppPaneGroup({
  autoSaveId,
  direction = 'horizontal',
  children,
  ...rest
}: AppPaneGroupProps) {
  return (
    <OuterFrame data-qa={rest['data-qa']}>
      <Group autoSaveId={autoSaveId} direction={direction}>
        {children}
      </Group>
    </OuterFrame>
  );
}
