import { ReactNode } from 'react';
import styled from 'styled-components';

const Layout = styled.div`
  display: grid;
  grid-template-rows: 56px 1fr;
  grid-template-columns: 260px 1fr 420px;
  height: 100vh;
  background: var(--bg-app);
  font-family: var(--font-sans);
  color: var(--text-primary);
`;

const TopRow = styled.div`
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-card);
  padding: 0 16px;
`;

const LeftCol = styled.aside`
  background: var(--bg-card);
  border-right: 1px solid var(--border-card);
  overflow-y: auto;
  padding: 16px;
`;

const MainCol = styled.main`
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-app);
`;

const RightCol = styled.aside`
  background: var(--bg-card);
  border-left: 1px solid var(--border-card);
  overflow-y: auto;
  padding: 16px;
`;

export type ShellSlots = {
  topBar: ReactNode;
  leftRail: ReactNode;
  main: ReactNode;
  rightRail: ReactNode;
};

export function Shell({ topBar, leftRail, main, rightRail }: ShellSlots) {
  return (
    <Layout>
      <TopRow>{topBar}</TopRow>
      <LeftCol>{leftRail}</LeftCol>
      <MainCol>{main}</MainCol>
      <RightCol>{rightRail}</RightCol>
    </Layout>
  );
}
