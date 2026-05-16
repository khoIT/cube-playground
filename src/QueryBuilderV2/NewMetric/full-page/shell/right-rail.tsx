import { ReactNode } from 'react';
import styled from 'styled-components';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
`;

const HeaderStrip = styled.div`
  flex: 0 0 auto;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-card);
  padding: 16px 20px 12px;
`;

const HeaderTitle = styled.div`
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 4px;
`;

const HeaderSub = styled.div`
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text-secondary);
  word-break: break-all;
`;

const Body = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
`;

export type RightRailProps = { title: string; subtitle?: string; children?: ReactNode };

export function RightRail({ title, subtitle, children }: RightRailProps) {
  return (
    <Wrap>
      <HeaderStrip>
        <HeaderTitle>{title}</HeaderTitle>
        {subtitle && <HeaderSub>{subtitle}</HeaderSub>}
      </HeaderStrip>
      <Body>{children}</Body>
    </Wrap>
  );
}
