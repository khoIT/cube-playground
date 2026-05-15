import { ReactNode } from 'react';
import styled from 'styled-components';
import { Panel } from 'react-resizable-panels';

const PaneShell = styled.section`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pane);
  box-shadow: var(--shadow-pane);
  overflow: hidden;
  font-family: var(--font-sans);
`;

type AppPaneProps = {
  id: string;
  order?: number;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  collapsible?: boolean;
  collapsedSize?: number;
  children: ReactNode;
  'data-qa'?: string;
};

export function AppPane({
  id,
  order,
  defaultSize,
  minSize,
  maxSize,
  collapsible,
  collapsedSize,
  children,
  ...rest
}: AppPaneProps) {
  return (
    <Panel
      id={id}
      order={order}
      defaultSize={defaultSize}
      minSize={minSize}
      maxSize={maxSize}
      collapsible={collapsible}
      collapsedSize={collapsedSize}
    >
      <PaneShell data-qa={rest['data-qa']}>{children}</PaneShell>
    </Panel>
  );
}

export { PaneShell };
