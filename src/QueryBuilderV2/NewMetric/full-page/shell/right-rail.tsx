import { ReactNode } from 'react';
import styled from 'styled-components';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;
const Header = styled.div`
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  margin-bottom: 4px;
`;
const Sub = styled.div`
  font-size: 12.5px;
  color: var(--text-muted);
  margin-bottom: 16px;
`;
const Body = styled.div`
  flex: 1;
`;

export type RightRailProps = { title: string; subtitle?: string; children?: ReactNode };

export function RightRail({ title, subtitle, children }: RightRailProps) {
  return (
    <Wrap>
      <Header>{title}</Header>
      {subtitle && <Sub>{subtitle}</Sub>}
      <Body>{children}</Body>
    </Wrap>
  );
}
