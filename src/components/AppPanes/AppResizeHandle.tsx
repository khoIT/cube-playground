import styled from 'styled-components';
import { PanelResizeHandle } from 'react-resizable-panels';

const Rail = styled(PanelResizeHandle)`
  width: var(--pane-gap);
  background: transparent;
  cursor: col-resize;
  position: relative;
  flex: 0 0 var(--pane-gap);

  &[data-panel-group-direction='vertical'] {
    width: 100%;
    height: var(--pane-gap);
    flex: 0 0 var(--pane-gap);
    cursor: row-resize;
  }

  &[data-resize-handle-active] {
    background: rgba(0, 0, 0, 0.04);
  }
`;

type AppResizeHandleProps = {
  id?: string;
  'data-qa'?: string;
};

export function AppResizeHandle({ id, ...rest }: AppResizeHandleProps) {
  return <Rail id={id} data-qa={rest['data-qa']} />;
}
